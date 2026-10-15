# Test Weakening provenance

This file is generated from the benchmark definition.

## Seeded test-weakening repository generator

- Kind: `synthetic`
- URL: https://github.com/pooriaarab/benchmark-test-weakening/blob/main/scripts/gen-tasks.mjs
- Licence: `MIT`
- Retrieved: 2026-10-15T00:00:00.000Z
- How to get it: Run `node scripts/gen-tasks.mjs --seed 20261015 --split public`. To create an untracked evaluation candidate, run `node scripts/gen-tasks.mjs --seed N --split hidden` and review `data/tasks-hidden.jsonl` privately.
- Contamination notes: The 30 public repositories and reference solutions were frozen on 2026-10-15 and are visible in this package. Public scores are reproducibility checks, not secret evaluations. A final evaluation uses a separately seeded, privately reviewed hidden JSONL that is never committed or published; the public generator reveals its task families, so hidden results must be described as held-out variants rather than novel problem types.
- Refresh: Review new modules and mutants once per minor release, select a new seed, regenerate both splits, and record the seed and review date. Do not silently change tasks within a released version.
