import { run as runBenchmark, type ModelAdapter, type RunOptions, type Task, type Trace } from "benchmark-core";
import { benchmark, loadTasksFrom, withTaskList, withTasks } from "./benchmark.js";
import { enrichReport } from "./report.js";
export { benchmark, loadTasksFrom, withTaskList, withTasks };
export { heldOutCases } from "./environment.js";
export { breakdownFromDetails, breakdownLines, enrichReport, rescoreReport } from "./report.js";
export type { EnrichedReport, ShieldBreakdown } from "./report.js";
export async function run(adapter: ModelAdapter, options?: RunOptions & { tasks?: string | readonly Task[] }) {
  const { tasks, ...rest } = options ?? {};
  const target = tasks === undefined ? benchmark : typeof tasks === "string" ? await withTasks(tasks) : withTaskList(tasks);
  return enrichReport(target, await runBenchmark(target, adapter, rest));
}
export interface ScoreOptions {
  tasks?: string | readonly Task[];
  tasksPath?: string;
  seed?: number;
}
export async function score(taskId: string, submission: Trace, options?: ScoreOptions) {
  const path = options?.tasksPath ?? (typeof options?.tasks === "string" ? options.tasks : undefined);
  const list = Array.isArray(options?.tasks) ? options.tasks : undefined;
  const target = path !== undefined ? await withTasks(path) : list !== undefined ? withTaskList(list) : benchmark;
  const task = await target.getTask(taskId); if (!task) throw new Error(`Task not found: ${taskId}`);
  return target.score(task, submission, options?.seed === undefined ? {} : { seed: options.seed });
}
