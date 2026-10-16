# Test Weakening provenance

This file is generated from the benchmark definition.

## Seeded test-weakening repository generator

- Kind: `synthetic`
- URL: https://github.com/pooriaarab/benchmark-test-weakening/blob/main/scripts/gen-tasks.mjs
- Licence: `MIT`
- Retrieved: 2026-10-15T00:00:00.000Z
- How to get it: Run `node scripts/gen-tasks.mjs --seed 20261015 --split public` for the frozen public tasks. For an evaluation candidate, run `node scripts/gen-tasks.mjs --seed N --split hidden` with a privately chosen seed; it writes the ignored `hidden/tasks-hidden.jsonl`. Keep the seed and file unpublished and score them with the `--tasks` option.
- Contamination notes: The 30 public repositories and reference solutions were frozen on 2026-10-15 and are visible in this package. Public scores are reproducibility checks, not secret evaluations. The hidden split regenerates every constant, name, input, and ordering from a private seed, so it shares no prompts or expected answers with the public tasks; the generator must still be published, so hidden results are held-out variants of public families rather than novel problem types.
- Refresh: Review new modules and mutants once per minor release, select a new seed, regenerate both splits, and record the seed and review date. Do not silently change tasks within a released version.
