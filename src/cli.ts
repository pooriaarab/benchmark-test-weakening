#!/usr/bin/env node
import { createCli } from "benchmark-core";
import { benchmark, withTasks } from "./benchmark.js";

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
process.exitCode = await createCli(target, { bin: "benchmark-test-weakening" }).main(argv);
