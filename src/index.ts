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
const scoredTaskFiles = new Map<string, Promise<ReturnType<typeof withTaskList>>>();
function scoredTasks(path: string) {
  let pending = scoredTaskFiles.get(path);
  if (!pending) { pending = withTasks(path); scoredTaskFiles.set(path, pending); }
  return pending;
}
export async function score(taskId: string, submission: Trace, options?: ScoreOptions) {
  if (options?.tasks !== undefined && options?.tasksPath !== undefined) {
    throw new Error("pass either tasks or tasksPath, not both");
  }
  const path = options?.tasksPath ?? (typeof options?.tasks === "string" ? options.tasks : undefined);
  const target = path !== undefined
    ? await scoredTasks(path)
    : Array.isArray(options?.tasks) ? withTaskList(options.tasks) : benchmark;
  const task = await target.getTask(taskId); if (!task) throw new Error(`Task not found: ${taskId}`);
  return target.score(task, submission, options?.seed === undefined ? {} : { seed: options.seed });
}
