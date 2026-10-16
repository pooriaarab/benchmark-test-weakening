import { AsyncLocalStorage } from "node:async_hooks";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "benchmark-core";

// Model answers are evaluated inside dedicated child processes drawn from a
// small pool, so every scoring evaluation sits under a hard wall-clock kill:
// an evaluation that overruns its budget loses its process to SIGKILL, which
// takes even a wedged thread with it, while the other evaluators keep serving
// concurrent requests. Requests and results travel over the IPC channel and
// jobs wait on a shared queue, so the parent's event loop never blocks and a
// burst of hostile answers cannot starve or corrupt honest scoring.
export const EVAL_TIMEOUT_MS = 2_000;
export const TASK_EVAL_WINDOW_MS = 10_000;
const EVALUATOR_POOL_SIZE = 4;
const EVALUATOR_MEMORY_MB = 256;
const REQ_CAP = 64 * 1024;

// Thrown only when the harness around the candidate evaluation fails - the
// wall clock fired, the task budget ran out, or the evaluator process died.
// An error raised by the candidate's own evaluation (a forbidden property, a
// step-budget overrun) comes back from the child as a plain failure instead:
// that is a real suite failure the tests earned, not an infrastructure kill.
export class SandboxKill extends Error {
  override name = "SandboxKill";
}

// Each gradeTrace call runs inside its own evaluation window carried by
// AsyncLocalStorage, so concurrent /v1/score requests never share a deadline.
// The window budgets charged evaluator time: a job accrues only the time it
// held a child, so waiting in the queue for a free evaluator slows a task
// down under load but can never exhaust its budget from the outside.
interface EvalWindow {
  spentMs: number;
}
const activeWindow = new AsyncLocalStorage<EvalWindow>();
export function withTaskEvalWindow<T>(run: () => Promise<T>): Promise<T> {
  return activeWindow.run({ spentMs: 0 }, run);
}

// The evaluator entry point, pool size, memory cap, and per-task budget are
// injectable so tests can point the pool at a fixture child (for example one
// that wedges on demand) without any test-only branch in production code.
export interface EvaluatorOptions {
  entry?: string;
  poolSize?: number;
  memoryMb?: number;
  windowMs?: number;
}
let overrides: EvaluatorOptions = {};

interface Job {
  id: number;
  body: { id: number; s: string; i: JsonValue };
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  window?: EvalWindow;
  startedAt?: number;
  timer?: NodeJS.Timeout;
}
interface Evaluator {
  child: ChildProcess;
  job: Job | undefined;
}

const evaluators = new Set<Evaluator>();
const queue: Job[] = [];
let seq = 0;
let childUsable = true;
let localFallback: ((source: string, input: JsonValue) => JsonValue) | undefined;

function windowLimit(): number {
  return overrides.windowMs ?? TASK_EVAL_WINDOW_MS;
}

function settle(job: Job, error?: Error, value?: JsonValue): void {
  if (job.timer) clearTimeout(job.timer);
  if (job.window && job.startedAt !== undefined) job.window.spentMs += Date.now() - job.startedAt;
  if (error) job.reject(error);
  else job.resolve(value ?? null);
}

// Retire one evaluator without touching the rest of the pool: its in-flight
// job fails cleanly and queued jobs keep flowing to the surviving children.
function retire(evaluator: Evaluator, message: string): void {
  if (!evaluators.delete(evaluator)) return;
  const job = evaluator.job;
  evaluator.job = undefined;
  try {
    evaluator.child.kill("SIGKILL");
  } catch { /* already dead */ }
  if (job) settle(job, new SandboxKill(message));
  pump();
}

function spawnEvaluator(): Evaluator | undefined {
  const entry = overrides.entry ?? fileURLToPath(new URL("./eval-child.js", import.meta.url));
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [`--max-old-space-size=${overrides.memoryMb ?? EVALUATOR_MEMORY_MB}`, entry], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
  } catch {
    childUsable = false;
    return undefined;
  }
  // Unref the process and its channel so a leftover evaluator can never keep
  // the parent alive; the per-job timer is the only handle that matters.
  child.unref();
  (child.channel as { unref?: () => void } | undefined)?.unref?.();
  const evaluator: Evaluator = { child, job: undefined };
  child.on("message", (message) => {
    const reply = message as { id?: number; ok?: boolean; value?: JsonValue; error?: string };
    const job = evaluator.job;
    if (!job || reply.id !== job.id) return;
    evaluator.job = undefined;
    if (reply.ok) settle(job, undefined, reply.value ?? null);
    else settle(job, new Error(reply.error ?? "evaluation failed"));
    pump();
  });
  const stopped = () => retire(evaluator, "evaluator process stopped");
  child.on("exit", stopped);
  child.on("error", stopped);
  evaluators.add(evaluator);
  return evaluator;
}

function runLocal(job: Job): void {
  try {
    if (!localFallback) throw new SandboxKill("evaluator process is not available");
    settle(job, undefined, localFallback(job.body.s, job.body.i));
  } catch (error) {
    settle(job, error instanceof Error ? error : new Error(String(error)));
  }
}

function pump(): void {
  while (queue.length > 0) {
    if (!childUsable) {
      runLocal(queue.shift()!);
      continue;
    }
    const job = queue[0]!;
    const remaining = job.window ? windowLimit() - job.window.spentMs : Number.POSITIVE_INFINITY;
    if (remaining <= 0) {
      queue.shift();
      settle(job, new SandboxKill("task evaluation time budget exhausted"));
      continue;
    }
    let evaluator: Evaluator | undefined;
    for (const item of evaluators) if (!item.job) { evaluator = item; break; }
    if (!evaluator) {
      if (evaluators.size >= (overrides.poolSize ?? EVALUATOR_POOL_SIZE)) break;
      evaluator = spawnEvaluator();
      if (!evaluator) continue;
    }
    queue.shift();
    const target = evaluator;
    target.job = job;
    job.startedAt = Date.now();
    job.timer = setTimeout(
      () => retire(target, "evaluation exceeded the wall-clock limit or the evaluator stopped"),
      Math.min(EVAL_TIMEOUT_MS, Math.max(1, remaining)),
    );
    try {
      target.child.send(job.body);
    } catch {
      retire(target, "evaluator is not writable");
    }
  }
}

// If the parent exits mid-evaluation its children must die with it: a wedged
// evaluator cannot observe the channel disconnect, so the exit event and the
// termination signals all SIGKILL the pool. Signals are re-sent after cleanup
// (our listener is once-only) so the parent still dies with normal signal
// semantics and whatever handlers the host installed.
function killAllEvaluators(): void {
  for (const evaluator of evaluators) {
    try {
      evaluator.child.kill("SIGKILL");
    } catch { /* already dead */ }
  }
}
process.on("exit", killAllEvaluators);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    killAllEvaluators();
    process.kill(process.pid, signal);
  });
}

export function evaluateSandboxed(
  source: string,
  input: JsonValue,
  evaluateLocal: (source: string, input: JsonValue) => JsonValue,
): Promise<JsonValue> {
  localFallback = evaluateLocal;
  const taskWindow = activeWindow.getStore();
  if (taskWindow && taskWindow.spentMs >= windowLimit()) {
    return Promise.reject(new SandboxKill("task evaluation time budget exhausted"));
  }
  if (JSON.stringify({ s: source, i: input ?? null }).length > REQ_CAP) {
    return Promise.reject(new SandboxKill("evaluation request exceeds the size limit"));
  }
  // Runtimes without child processes (for example edge isolates) still get the
  // in-process caps; the wall-clock kill needs process support.
  if (!childUsable) {
    try {
      return Promise.resolve(evaluateLocal(source, input));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return new Promise<JsonValue>((resolve, reject) => {
    queue.push({
      id: ++seq,
      body: { id: seq, s: source, i: input ?? null },
      resolve,
      reject,
      ...(taskWindow ? { window: taskWindow } : {}),
    });
    pump();
  });
}

// Replace the evaluator configuration and drain the current pool so the next
// job spawns under the new options. Returns a restore function that does the
// same drain. In-flight jobs under the old configuration fail cleanly.
export function configureEvaluator(options: EvaluatorOptions): () => void {
  const previous = overrides;
  overrides = { ...options };
  for (const evaluator of evaluators) retire(evaluator, "evaluator process stopped");
  return () => {
    overrides = previous;
    for (const evaluator of evaluators) retire(evaluator, "evaluator process stopped");
  };
}
