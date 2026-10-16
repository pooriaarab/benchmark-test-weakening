import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "benchmark-core";

// Model answers are evaluated inside a dedicated child process so every scoring
// evaluation sits under a hard wall-clock kill: an evaluation that overruns its
// budget loses the whole process to SIGKILL, which takes even a wedged thread
// with it. Requests and results travel over the IPC channel and jobs are
// serialized through a queue, so the parent's event loop never blocks.
export const EVAL_TIMEOUT_MS = 2_000;
export const TASK_EVAL_WINDOW_MS = 10_000;

// Thrown only when the harness around the candidate evaluation fails - the
// wall clock fired, the task window ran out, or the evaluator process died.
// An error raised by the candidate's own evaluation (a forbidden property, a
// step-budget overrun) comes back from the child as a plain failure instead:
// that is a real suite failure the tests earned, not an infrastructure kill.
export class SandboxKill extends Error {
  override name = "SandboxKill";
}

const REQ_CAP = 64 * 1024;

interface Job {
  id: number;
  body: { id: number; s: string; i: JsonValue; hook?: string };
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

let child: ChildProcess | undefined;
let childUsable = true;
let seq = 0;
let active: Job | undefined;
let windowEndsAt = Number.POSITIVE_INFINITY;
const queue: Job[] = [];

// gradeTrace brackets one task's evaluations with a window; calls outside a
// window still get the per-evaluation kill.
export function beginTaskEvalWindow(): void {
  windowEndsAt = Date.now() + TASK_EVAL_WINDOW_MS;
}
export function endTaskEvalWindow(): void {
  windowEndsAt = Number.POSITIVE_INFINITY;
}

function settle(job: Job, error?: Error, value?: JsonValue): void {
  if (job.timer) clearTimeout(job.timer);
  if (error) job.reject(error);
  else job.resolve(value ?? null);
}

function failActive(message: string): void {
  const job = active;
  active = undefined;
  if (child) {
    child.kill("SIGKILL");
    child = undefined;
  }
  if (job) settle(job, new SandboxKill(message));
  pump();
}

function ensureChild(): void {
  if (child) return;
  const spawned = spawn(process.execPath, [fileURLToPath(new URL("./eval-child.js", import.meta.url))], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  // Unref the process and its channel so a leftover evaluator can never keep
  // the parent alive; the per-job timer is the only handle that matters.
  spawned.unref();
  (spawned.channel as { unref?: () => void } | undefined)?.unref?.();
  spawned.on("message", (message) => {
    const reply = message as { id?: number; ok?: boolean; value?: JsonValue; error?: string };
    const job = active;
    if (!job || reply.id !== job.id) return;
    active = undefined;
    if (reply.ok) settle(job, undefined, reply.value ?? null);
    else settle(job, new Error(reply.error ?? "evaluation failed"));
    pump();
  });
  const retire = () => {
    if (child !== spawned) return;
    child = undefined;
    if (active) {
      const job = active;
      active = undefined;
      settle(job, new SandboxKill("evaluator process stopped"));
    }
    pump();
  };
  spawned.on("exit", retire);
  spawned.on("error", retire);
  child = spawned;
}

let localFallback: ((source: string, input: JsonValue) => JsonValue) | undefined;

function pump(): void {
  while (!active && queue.length > 0) {
    const job = queue.shift()!;
    const remaining = windowEndsAt - Date.now();
    if (remaining <= 0) {
      settle(job, new SandboxKill("task evaluation time budget exhausted"));
      continue;
    }
    try {
      ensureChild();
    } catch {
      childUsable = false;
    }
    if (!child || !childUsable) {
      try {
        if (!localFallback) throw new SandboxKill("evaluator process is not available");
        settle(job, undefined, localFallback(job.body.s, job.body.i));
      } catch (error) {
        settle(job, error instanceof Error ? error : new Error(String(error)));
      }
      continue;
    }
    active = job;
    job.timer = setTimeout(
      () => failActive("evaluation exceeded the wall-clock limit or the evaluator stopped"),
      Math.min(EVAL_TIMEOUT_MS, remaining),
    );
    try {
      child.send(job.body);
    } catch {
      failActive("evaluator is not writable");
    }
  }
}

export function evaluateSandboxed(
  source: string,
  input: JsonValue,
  evaluateLocal: (source: string, input: JsonValue) => JsonValue,
): Promise<JsonValue> {
  localFallback = evaluateLocal;
  if (windowEndsAt - Date.now() <= 0) return Promise.reject(new SandboxKill("task evaluation time budget exhausted"));
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
    const hook = process.env.BTW_EVAL_TEST_HOOK === "spin" ? "spin" : undefined;
    const job: Job = {
      id: ++seq,
      body: { id: seq, s: source, i: input ?? null, ...(hook ? { hook } : {}) },
      resolve,
      reject,
    };
    queue.push(job);
    pump();
  });
}
