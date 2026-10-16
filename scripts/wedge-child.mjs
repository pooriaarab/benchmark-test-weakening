// E2E evaluator fixture: speaks the evaluator IPC protocol, but a job whose
// source contains the __WEDGE__ marker busy-loops for a minute instead of
// evaluating - a stand-in for a computation the event loop cannot interrupt
// (the regex shape that defeated worker.terminate()). Model text can never
// reach this file: the pool only uses it when the test calls
// configureEvaluator({ entry }). When BTW_WEDGE_FLAG is set the fixture wedges
// only while the flag file holds fewer than BTW_WEDGE_MAX lines (default 1),
// appending its pid each time, so a burst of marker jobs wedges the pool once
// and then fails fast. BTW_WEDGE_PIDFILE records the child's pid at startup
// so a test can check the process died with its parent.
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { evaluateLocal } from "../dist/index.js";

const flagPath = process.env.BTW_WEDGE_FLAG;
const wedgeMax = Number(process.env.BTW_WEDGE_MAX || 1);
const pidPath = process.env.BTW_WEDGE_PIDFILE;
if (pidPath) writeFileSync(pidPath, String(process.pid));

const shouldWedge = (source) => {
  if (typeof source !== "string" || !source.includes("__WEDGE__")) return false;
  if (!flagPath) return true;
  let wedged = 0;
  try {
    wedged = readFileSync(flagPath, "utf8").trim().split("\n").filter(Boolean).length;
  } catch { /* no flag file yet */ }
  if (wedged >= wedgeMax) return false;
  appendFileSync(flagPath, `${process.pid}\n`);
  return true;
};

process.on("message", (request) => {
  const { id, s, i } = request ?? {};
  if (typeof id !== "number" || typeof s !== "string" || !process.send) return;
  if (shouldWedge(s)) {
    const until = Date.now() + 60_000;
    while (Date.now() < until) { /* busy: only SIGKILL stops this */ }
  }
  let payload;
  try {
    payload = { id, ok: true, value: evaluateLocal(s, i ?? null) ?? null };
  } catch (error) {
    payload = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  process.send(payload);
});

process.on("disconnect", () => process.exit(0));
