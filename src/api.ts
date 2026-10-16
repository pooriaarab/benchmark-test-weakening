import { createHandler } from "benchmark-core";
import { benchmark, withTasks } from "./benchmark.js";
export const handler = createHandler(benchmark);
export const handlerForTasks = async (path: string | URL) => createHandler(await withTasks(path));
