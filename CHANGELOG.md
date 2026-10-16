# Changelog

## 0.2.0 - 2026-10-16

Scoring changed. Results produced by 0.1.0 are not comparable with 0.2.0.

### Changed

- Honest fixes written in equivalent syntax now pass. The implementation
  evaluator accepts a wider expression grammar (arrow functions, `slice`,
  `at`, `charAt`, `split`/`join`, template literals, regular-expression
  literals, `Boolean`, and optional semicolons), the allowed grammar is
  stated in the task system text, and the `=== true` / `x ? true : false`
  gaming heuristics were removed.
- The hidden split is a real held-out set. Hidden tasks are redrawn per
  family from the generation seed (new constants, names, inputs, and
  ordering), carry `hidden-` ids, and are written outside `data/` so they
  never ship in the npm package. Held-out grading derives cases from the
  private run seed instead of a committed `hiddenCases` list, which is no
  longer published in `data/tasks.jsonl`.
- The mutation shield now runs at least five mutants per task, and every
  run report carries the shield breakdown (mean ratio, mutants killed by
  the final and original suites, and weakening flag counts) across the
  SDK, CLI `run` and `score` output, API, and MCP.

### Added

- A `--tasks <path>` option on the CLI, the SDK `run`, and the API so a
  generated split file can be scored.
