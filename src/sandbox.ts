import { Worker } from "node:worker_threads";
import type { JsonValue } from "benchmark-core";

// Model answers are evaluated inside a worker thread so every scoring
// evaluation sits under a hard wall-clock kill: a catastrophic regex or an
// over-budget computation blocks the worker's thread, never the benchmark's,
// and terminating the worker leaves the parent responsive.
export const EVAL_TIMEOUT_MS = 2_000;
export const TASK_EVAL_WINDOW_MS = 10_000;

const HEADER_INTS = 4;
const REQ_CAP = 64 * 1024;
const RES_CAP = 512 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let worker: Worker | undefined;
let flags: Int32Array | undefined;
let reqBytes: Uint8Array | undefined;
let resBytes: Uint8Array | undefined;
let seq = 0;
let workerUsable = true;
let windowEndsAt = Number.POSITIVE_INFINITY;

// gradeTrace brackets one task's evaluations with a window; calls outside a
// window still get the per-evaluation kill.
export function beginTaskEvalWindow(): void {
  windowEndsAt = Date.now() + TASK_EVAL_WINDOW_MS;
}
export function endTaskEvalWindow(): void {
  windowEndsAt = Number.POSITIVE_INFINITY;
}

function ensureWorker(): void {
  if (worker) return;
  const sab = new SharedArrayBuffer(HEADER_INTS * 4 + REQ_CAP + RES_CAP);
  const sharedFlags = new Int32Array(sab, 0, HEADER_INTS);
  flags = sharedFlags;
  reqBytes = new Uint8Array(sab, HEADER_INTS * 4, REQ_CAP);
  resBytes = new Uint8Array(sab, HEADER_INTS * 4 + REQ_CAP, RES_CAP);
  seq = 0;
  const spawned = new Worker(new URL("./eval-worker.js", import.meta.url), {
    workerData: { sab },
    // The worker runs a plain file; inherited flags like --input-type or
    // --eval would kill it on boot.
    execArgv: [],
  });
  spawned.unref();
  const retire = () => {
    if (worker !== spawned) return;
    worker = undefined;
    Atomics.store(sharedFlags, 1, -1);
    Atomics.notify(sharedFlags, 1);
  };
  spawned.on("error", retire);
  spawned.on("exit", (code) => {
    if (code !== 0) retire();
  });
  worker = spawned;
}

export function evaluateSandboxed(
  source: string,
  input: JsonValue,
  evaluateLocal: (source: string, input: JsonValue) => JsonValue,
): JsonValue {
  const remaining = windowEndsAt - Date.now();
  if (remaining <= 0) throw new Error("task evaluation time budget exhausted");
  const request = encoder.encode(JSON.stringify({ s: source, i: input ?? null }));
  if (request.length > REQ_CAP) throw new Error("evaluation request exceeds the size limit");
  if (workerUsable) {
    try {
      ensureWorker();
    } catch {
      workerUsable = false;
    }
  }
  // Runtimes without worker threads (for example edge isolates) still get the
  // in-process caps; the wall-clock kill needs worker support.
  if (!workerUsable) return evaluateLocal(source, input);
  const sharedFlags = flags as Int32Array;
  const requests = reqBytes as Uint8Array;
  const responses = resBytes as Uint8Array;
  requests.set(request);
  Atomics.store(sharedFlags, 2, request.length);
  Atomics.store(sharedFlags, 0, ++seq);
  Atomics.notify(sharedFlags, 0);
  Atomics.wait(sharedFlags, 1, seq - 1, Math.min(EVAL_TIMEOUT_MS, remaining));
  if (Atomics.load(sharedFlags, 1) !== seq) {
    const stuck = worker;
    worker = undefined;
    if (stuck) void stuck.terminate();
    throw new Error("evaluation exceeded the wall-clock limit or the worker stopped");
  }
  const length = Atomics.load(sharedFlags, 3);
  const parsed = JSON.parse(decoder.decode(responses.subarray(0, length))) as
    { ok: boolean; value?: JsonValue; error?: string };
  if (!parsed.ok) throw new Error(parsed.error ?? "evaluation failed");
  return parsed.value ?? null;
}
