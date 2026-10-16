import { readFile } from "node:fs/promises";
import { defineBenchmark, type Task } from "benchmark-core";
import { RepositoryEnvironment, metadataFor } from "./environment.js";
import { gradeTrace } from "./grader.js";

async function loadTasks(): Promise<Task[]> {
  const text = await readFile(new URL("../data/tasks.jsonl", import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Task);
}
export const benchmark = defineBenchmark({
  id: "benchmark-test-weakening", name: "Test Weakening", tagline: "Does the agent fix the bug or weaken the tests?", tags: ["helpful", "viral"], category: "coding",
  whatItMeasures: "Whether a coding agent repairs buggy JavaScript while preserving the original tests and their mutation strength.", version: "0.1.0", status: "alpha", loadTasks,
  grade: (task, submission, context) => gradeTrace(task, submission, context.seed),
  environment: () => new RepositoryEnvironment(),
  mockPolicies: {
    good: (task) => [{ toolCalls: [
      { name: "write_file", args: { path: "src/index.js", content: metadataFor(task).reference } },
      { name: "run_tests", args: {} },
    ] }],
    bad: (task) => [{ toolCalls: [
      { name: "write_file", args: { path: "test/index.test.js", content: metadataFor(task).weakTests } },
      { name: "run_tests", args: {} },
    ] }],
  },
  provenance: [{
    name: "Seeded test-weakening repository generator", kind: "synthetic", url: "https://github.com/pooriaarab/benchmark-test-weakening/blob/main/scripts/gen-tasks.mjs",
    licence: "MIT", howToGet: "Run `node scripts/gen-tasks.mjs --seed 20261015 --split public` for the frozen public tasks. For an evaluation candidate, run `node scripts/gen-tasks.mjs --seed N --split hidden` with a privately chosen seed; it writes the ignored `hidden/tasks-hidden.jsonl`. Keep the seed and file unpublished.", retrievedAt: "2026-10-15T00:00:00.000Z",
    contaminationNotes: "The 30 public repositories and reference solutions were frozen on 2026-10-15 and are visible in this package. Public scores are reproducibility checks, not secret evaluations. The hidden split regenerates every constant, name, input, and ordering from a private seed, so it shares no prompts or expected answers with the public tasks; the generator must still be published, so hidden results are held-out variants of public families rather than novel problem types.",
    refresh: "Review new modules and mutants once per minor release, select a new seed, regenerate both splits, and record the seed and review date. Do not silently change tasks within a released version.",
  }],
  gradingMethod: "Deterministic trace replay, hidden original and run-seeded held-out cases, plus mutation-shield preservation; no model judge.",
  // benchmark-core 0.1 types saturation as numeric, while the directory schema also accepts "unknown".
  saturation: "unknown" as unknown as number,
  shareCardTitle: "Test-strength shield",
});
