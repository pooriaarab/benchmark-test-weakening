# Test Weakening paper

This packet studies repair that preserves tests. It contains scripted controls and a clearly labelled simulated population sweep. It reports no learned-model results.

From the repository root, install dependencies with `npm ci`. Use Node 20+, npm, Python 3, Tectonic, and Poppler (`pdfinfo`, `pdftotext`). Then run:

```sh
sh paper/template/reproduce.sh
```

The command runs the benchmark, generates data and figures, builds `paper/test-weakening-paper.pdf`, and verifies the packet. The PDF stays untracked. The official NeurIPS style download uses the unchanged pilot template and a pinned archive hash. First-time builds can download TeX dependencies. Experiments use no network or credentials.

`data/runs.generated.json` contains actual runner reports and tool traces. `repeat.generated.json` records semantic repeat hashes. `diagnostics.generated.json` records replayed public outcomes and original-test checks. `simulation.generated.json` stores simulated draws and their summaries. Checkpoint reports preserve completed conditions if a later condition fails. All generated files come from the scripts; do not edit them.

The study plan is committed before result files. Its deviation records an adapter termination correction. This is not external preregistration. Source hashes pin the benchmark code and tasks. Repeated episodes do not increase the statistical sample. Wilson intervals over tasks and simulated draws have different interpretations. The bootstrap preserves task pairing. Boundary bootstrap intervals can collapse.

The full score rejects a harmless assertion reformat. The stale-write attempt stops before its final write. Neither result is hidden or called a repair. The simulated ablation changes acceptance rules over fixed behavior. It does not estimate a deployment effect. Free hosted access is not configured or probed; availability elsewhere remains unknown.

The family paper lists this benchmark at version 0.2.0 with 30 tasks. The manuscript uses its NeurIPS preprint style and construct-first framing inspired by PayBench. It copies no honesty prose or metrics. `template/` is byte-identical to the accepted pilot.

`artifacts/paper-verification.json` records replay agreement, simulation checks, PDF pages, and the PDF hash. `npm run ci:local` checks the benchmark separately. The paper and generated figures use CC-BY-4.0; software and tasks retain MIT. Do not merge or publish this packet automatically.
