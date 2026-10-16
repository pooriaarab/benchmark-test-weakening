import { workerData } from "node:worker_threads";
import type { JsonValue } from "benchmark-core";
import { evaluateLocal } from "./environment.js";

// Jobs and results travel through shared memory only: the worker blocks in
// Atomics.wait between jobs, so the parent can always kill it mid-evaluation.
const HEADER_INTS = 4;
const REQ_CAP = 64 * 1024;
const RES_CAP = 512 * 1024;

const sab = (workerData as { sab: SharedArrayBuffer }).sab;
const flags = new Int32Array(sab, 0, HEADER_INTS);
const requests = new Uint8Array(sab, HEADER_INTS * 4, REQ_CAP);
const responses = new Uint8Array(sab, HEADER_INTS * 4 + REQ_CAP, RES_CAP);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let seen = 0;
for (;;) {
  Atomics.wait(flags, 0, seen);
  seen = Atomics.load(flags, 0);
  const job = decoder.decode(requests.subarray(0, Atomics.load(flags, 2)));
  let payload: { ok: boolean; value?: unknown; error?: string };
  try {
    const { s, i } = JSON.parse(job) as { s: string; i: JsonValue };
    payload = { ok: true, value: evaluateLocal(s, i) ?? null };
  } catch (error) {
    payload = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  let encoded = encoder.encode(JSON.stringify(payload));
  if (encoded.length > RES_CAP) {
    encoded = encoder.encode('{"ok":false,"error":"evaluation result exceeds the size limit"}');
  }
  responses.set(encoded);
  Atomics.store(flags, 3, encoded.length);
  Atomics.store(flags, 1, seen);
  Atomics.notify(flags, 1);
}
