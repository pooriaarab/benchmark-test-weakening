#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  createCli, mockAdapter, openaiCompatAdapter, openrouterAdapter, renderMarkdown,
  run as runBenchmark, type Benchmark, type ModelAdapter, type RunReport, type Task,
} from "benchmark-core";
import { benchmark, withTasks } from "./benchmark.js";
import { startMcp } from "./mcp.js";
import { breakdownLines, enrichReport, rescoreReport } from "./report.js";

class UsageError extends Error {}
const isUsageError = (error: unknown): boolean =>
  error instanceof UsageError
  || (typeof error === "object" && error !== null && String(Reflect.get(error, "code") ?? "").startsWith("ERR_PARSE_ARGS"));
const usageText = "Usage: benchmark-test-weakening <list|show|run|score|card|provenance|index-entry|serve|mcp> [options]";

const adapterFor = (provider: string, model: string, target: Benchmark<Task>, seed: number): ModelAdapter => {
  if (provider === "mock") return mockAdapter({ seed, ...(target.definition.mockPolicies ? { policies: target.definition.mockPolicies } : {}) });
  if (provider === "openrouter") return openrouterAdapter({ model });
  if (provider === "openai") return openaiCompatAdapter({ model });
  throw new UsageError("--provider must be openrouter, openai, or mock.");
};

async function runCommand(target: Benchmark<Task>, rest: string[]): Promise<number> {
  const json = rest.includes("--json");
  const parsed = parseArgs({
    args: rest.filter((arg) => arg !== "--json"), strict: true,
    options: {
      model: { type: "string" }, provider: { type: "string" }, concurrency: { type: "string" },
      timeout: { type: "string" }, retries: { type: "string" }, seed: { type: "string" },
      "max-turns": { type: "string" }, "max-tool-calls": { type: "string" }, budget: { type: "string" },
    },
  });
  const { model, provider } = parsed.values;
  if (!model || !provider) throw new UsageError("run needs --model and --provider.");
  const seed = Number(parsed.values.seed ?? 1);
  const report = await runBenchmark(target, adapterFor(provider, model, target, seed), {
    ...(parsed.values.concurrency ? { concurrency: Number(parsed.values.concurrency) } : {}),
    ...(parsed.values.timeout ? { timeoutMs: Number(parsed.values.timeout) } : {}),
    ...(parsed.values.retries ? { retries: Number(parsed.values.retries) } : {}),
    seed,
    ...(parsed.values["max-turns"] ? { maxTurns: Number(parsed.values["max-turns"]) } : {}),
    ...(parsed.values["max-tool-calls"] ? { maxToolCalls: Number(parsed.values["max-tool-calls"]) } : {}),
    ...(parsed.values.budget ? { budgetUsd: Number(parsed.values.budget) } : {}),
  });
  const enriched = await enrichReport(target, report);
  console.log(json ? JSON.stringify(enriched) : `${renderMarkdown(enriched)}${breakdownLines(enriched.breakdown)}`);
  return report.rows.some((row) => row.error) ? 2 : 0;
}

async function scoreCommand(target: Benchmark<Task>, rest: string[]): Promise<number> {
  const json = rest.includes("--json");
  const clean = rest.filter((arg) => arg !== "--json");
  const file = clean[0];
  if (!file) throw new UsageError("score needs a results JSON file.");
  const original = JSON.parse(await readFile(file, "utf8")) as RunReport;
  if (!original || typeof original !== "object" || !Array.isArray(original.rows)) throw new UsageError("File is not a run report.");
  for (const row of original.rows) {
    if (row.submission === undefined || !(await target.getTask(row.taskId))) throw new UsageError(`Cannot score task ${row.taskId}.`);
  }
  const rescored = await rescoreReport(target, original);
  console.log(json ? JSON.stringify(rescored) : `${renderMarkdown(rescored)}${breakdownLines(rescored.breakdown)}`);
  return 0;
}

const argv = process.argv.slice(2);
const tasksIndex = argv.indexOf("--tasks");
let target = benchmark;
if (tasksIndex !== -1) {
  const path = argv[tasksIndex + 1];
  if (!path || path.startsWith("--")) {
    console.error("--tasks needs a JSONL file path.");
    process.exit(1);
  }
  argv.splice(tasksIndex, 2);
  target = await withTasks(path);
}

try {
  const command = argv[0];
  if (command === "run") process.exitCode = await runCommand(target, argv.slice(1));
  else if (command === "score") process.exitCode = await scoreCommand(target, argv.slice(1));
  else if (command === "mcp") { await startMcp(target); process.exitCode = 0; }
  else process.exitCode = await createCli(target, { bin: "benchmark-test-weakening" }).main(argv);
} catch (caught) {
  console.error(caught instanceof Error ? caught.message : String(caught));
  if (isUsageError(caught)) { console.error(usageText); process.exitCode = 1; } else process.exitCode = 2;
}
