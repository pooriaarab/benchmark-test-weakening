# Changelog

## 0.2.0 - 2026-10-16

Scoring changed. Results produced by 0.1.0 are not comparable with 0.2.0.

### Security

- 0.1.0 evaluated model-written answers in-process through `Function(...)`
  behind a syntax allow-list. A member name computed at run time (for example
  `input[String.fromCharCode(...)]` resolving to `constructor`) could escape
  the allow-list and execute arbitrary code in the benchmark process. 0.2.0
  replaces the evaluator with a parser plus tree-walking interpreter for the
  documented grammar: model text never reaches `eval`, `Function`, `vm`,
  `import()`, or `require`, and property reads resolve only through an
  explicit `(value type, property)` allow-list.
- Denial-of-service holes are closed. Regular expressions are removed from
  the grammar entirely: `/a?a?...a/.test("a".repeat(100))` fit the old
  safe-subset rules, hit the 2 s wall-clock kill, and then kept spinning -
  `worker.terminate()` cannot interrupt a backtracking regex, so the worker
  leaked and the parent could never exit. No literals, `RegExp`,
  `match`/`test`/`search`/`exec`, or regex arguments to `replace`/`split`
  are accepted now; string methods cover the same cases. Evaluations moved
  from a worker thread blocked on `Atomics.wait` to a dedicated child
  process awaited over IPC: the parent's event loop stays free (a hostile
  `/v1/score` request used to freeze the API for 10 s) and an evaluator that
  overruns is SIGKILLed with its process, so even a wedged computation dies.
  The step budget can no longer be forged: `Object.values(Array.from)` used
  to leak the interpreter's internal `call` function, which a model-built
  `{ steps: 1e18 }` then drove past every limit; builtins and closures are
  now class instances with private state, and `Object` inspection helpers
  refuse callables and functions. `BigInt` was removed from the grammar
  because `BigInt("9".repeat(150000)) ** 900n` hung the evaluator.
- A suite whose evaluation fails or times out no longer counts mutants as
  killed: only a real assertion failure is a kill, and the task is marked
  failed with an `evaluationFailed` detail instead of a phantom shield.
- Concurrent scoring is isolated. The single shared evaluator and
  process-global task window let hostile `/v1/score` answers corrupt honest
  requests scored at the same time. Evaluations now run in a small pool of
  child processes, each task's window is carried by the request's async
  context, and only the time a job holds an evaluator is charged - queue wait
  no longer burns a task's budget. Children run under a 256 MB heap cap and
  are SIGKILLed on a normal parent exit - process exit, a thrown error,
  SIGINT, or SIGTERM - even mid-evaluation.
  The `BTW_EVAL_TEST_HOOK` test knob is gone from shipped code; the E2E
  injects its fixture child through `configureEvaluator` instead.

### Changed

- Honest fixes written in equivalent syntax now pass. The implementation
  evaluator accepts a wider expression grammar (arrow functions, `slice`,
  `at`, `charAt`, `split`/`join`, template literals, `Boolean`, and optional
  semicolons), the allowed grammar is stated in the task system text, and
  the `=== true` / `x ? true : false` gaming heuristics were removed.
- Missing data reads match JavaScript: an absent key on a plain object and
  an out-of-range or negative index on an array or string return
  `undefined` instead of raising a grammar error, so honest answers using
  optional data shape pass. The member allow-list is unchanged for named
  members.
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
  generated split file can be scored. The SDK `score` accepts `tasks`,
  `tasksPath`, and `seed` options to mirror a run's split and held-out seed.
- `export default <name>` and aliased `export { f as solve }` forms, and
  object literals, in the accepted implementation grammar.

### Known limits

- Measured limits that ship with 0.2.0 are listed in the README Limits
  section: API latency can reach several seconds under a flood of hostile
  `/v1/score` answers while scores stay correct, a parent killed with
  SIGKILL can orphan a spinning evaluator child, and an out-of-memory kill
  can print the child's stack trace on the parent's stderr.
