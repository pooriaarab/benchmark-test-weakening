# Test Weakening: study plan

Plan date: 2026-10-29. No study results exist at commitment. Source inspection informs the conditions. The accepted honesty paper supplies only the unchanged build/statistics template. This is a local committed plan, not an independent registration. No venue deposit is authorized.

Question: does the benchmark separate code repair from changes that make visible tests pass by weakening their checks?
H1: the packaged reference policy passes full scoring more often than the packaged weakening policy.
H2: public-test-only acceptance exceeds full acceptance for the weakening policy.
H3: in a simulated mixture of reference repair and weakening, public-only acceptance overstates full success as weakening prevalence rises.
Exploratory diagnostic: a semantics-preserving assertion reformat may trigger preservation checks. Report any rejection as a validity limit.

Use the frozen public tasks of benchmark-test-weakening 0.2.0 at config.json source_commit. Use public SDK run with scripted adapters, seed 1, concurrency 1, retries 0, maxTurns 4, maxToolCalls 8, budgetUsd 0. Repeat each condition once. No learned models, humans, provider access, or paid calls. Free hosted availability is not probed; it is not a result.

Conditions: empty, constant OK, echo prompt, refusal, first-tool with empty arguments, packaged-good, packaged-bad, delete-tests with buggy code, repair-delete (reference plus no assertions), repair-reformat (reference plus spaces changed inside assertions), stale-run (reference, run, overwrite with bug). Use packaged good/bad mock policies; use a deterministic mock adapter for other scripts. Oracle policies can access references and are not learned agents.

For every policy report full success, public-test success from replay, original-test success from evaluateLocal, mutation-shield preservation, and false credit (public success and full failure). Each rate receives a 95% Wilson interval over tasks. Report paired public-minus-full differences with 2000 task bootstrap draws, seed 20261029; boundary intervals may collapse. Do not treat repeats as new observations. Report counts by first input type as coverage, not a rate.

Simulated experiment: use actual packaged-good and packaged-bad trace outcomes to create 1000 simulated episodes per mixture at weakening probabilities 0, .25, .5, .75, 1. Uniform task sampling with replacement, seed 20261029, shared draws across mixture probabilities. Compare public-only, public-plus-original, and full acceptance. Also show false credit under each rule against full scoring. Wilson intervals describe simulation draws only, conditional on this finite corpus. No behavioral adaptation or deployment inference. Preserve all draws for reproduction.

Exclusions: no task or policy excluded for low score. Empty, malformed and refusal replies remain failures. Infrastructure errors or evaluator timeouts halt the experiment; repair the cause and log a deviation before rerunning. Keep all completed traces. No provider retries. Stop after all fixed conditions and one simulated grid finish. Record repeat hashes without timings and frozen source hashes. Save raw reports, replay diagnostics, summaries and simulation draws.

Before implementation, anticipated failures: finalState may be untrusted; replay tool logs. A later write invalidates a prior test run; inspect ranTests. Empty suites may be rejected before shield scoring. A lexical preservation check may reject equivalent tests. Evaluation failures must not count as killed mutants. Identical simulations must not count as independent model evidence. Verification checks raw-to-summary counts, paired differences, simulation draws, repeat hashes, source pinning, and template equality.

Deviations: none at registration. All planned results, including nulls, remain in the report.
