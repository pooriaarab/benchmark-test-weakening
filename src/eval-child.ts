import type { JsonValue } from "benchmark-core";
import { evaluateLocal } from "./environment.js";

// Scoring evaluations run inside this dedicated child process: if a job
// overruns the parent's wall-clock limit the whole process is SIGKILLed, so a
// wedged computation dies with its process instead of leaking a spinning
// thread. Jobs arrive over the IPC channel, one at a time.
interface EvalRequest { id?: number; s?: string; i?: JsonValue; hook?: string }

process.on("message", (request: EvalRequest) => {
  const { id, s, i, hook } = request;
  if (typeof id !== "number" || typeof s !== "string" || !process.send) return;
  // Test hook: simulates a computation the event loop cannot interrupt, like a
  // backtracking regex on a model-chosen pattern. Only the parent can set it,
  // through BTW_EVAL_TEST_HOOK; model text can never reach it. Bounded at one
  // minute so a leaked loop can never spin forever even if the kill failed.
  if (hook === "spin") {
    const until = Date.now() + 60_000;
    while (Date.now() < until) { /* busy */ }
  }
  let payload: { id: number; ok: boolean; value?: JsonValue; error?: string };
  try {
    payload = { id, ok: true, value: evaluateLocal(s, i ?? null) ?? null };
  } catch (error) {
    payload = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (JSON.stringify(payload).length > 512 * 1024) {
    payload = { id, ok: false, error: "evaluation result exceeds the size limit" };
  }
  process.send(payload);
});

// When the parent goes away the channel closes; leave rather than linger.
process.on("disconnect", () => process.exit(0));
