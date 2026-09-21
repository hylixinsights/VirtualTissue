# Release verification — 6.1.1

The original release passed `scripts/check_all.py` in the working checkout and in
an isolated copy of the allowlisted export. The direct injury and toxin display corrections
passed the complete suite in the public checkout. No paid Jev calls were made. Local
HTTP integration used synthetic upstream responses; browser tests used real
WebGL in headless Chrome. The direct injury profile was followed by a rebuild, regenerated fixture examples
and the complete suite, including Studio and offline-player checks.

| Suite | Passed |
| --- | --- |
| Node engine, contracts, host biology and episode tests | 183 |
| Immutable reference kernel | 43 |
| Python server, budgets, Choice and release tests | 85 |
| Studio desktop/mobile, biological outcomes and offline player checks | 67 |
| Total named checks | 378 |

Reproduction scripts, deterministic build checks and release packaging also
passed. These are software checks, not scientific calibration or live-Jev
validation. All four bundled scenario recordings are complete fixtures with zero
API calls, independent run IDs and fresh baseline frames. Quiet baseline has no
decisions. Per-cell decisions are preserved independently of visual sampling.

The invalid-probability regressions cover malformed shape/types, missing and extra
options, nonfinite values, range and sum failures, choice consistency, confidence,
usage retention, physical-state atomicity and a visible browser pause with a
saveable partial recording. No original failing live response was available;
the tests reconstruct contract violations rather than claiming its exact cause.

Desktop/mobile screenshots were inspected. Display changes add toxin fields,
separate barrier/cell damage readouts, per-cell exposure rings and visible injury
marks; original cell geometry remains unchanged. Regression tests cover a six-cell
locally tapered wound with 80% core cell damage and health 20, unchanged distant
cells, preserved terminal states, positive ETEC toxin exposure, older
recordings without toxin grids, and unchanged physical state during visualization.
The manual is generated from the active v3 document and includes all 56 exact
contracts, with unsupported handlers visibly identified.

The export excludes Git history, local `.env`, private runs, virtual environments,
caches, stale reports, obsolete browser tests and old UI code. The blank
`.env.example` is intentional. The packaging scanner examines plain files,
reference DOCX contents and decompressed fixtures. All local Markdown links in
the export resolve. `RELEASE_MANIFEST.json` contains file hashes.

The original clean release was published with fresh Git history. Version 6.1.1 includes the verified injury and display corrections, creator credits
and conceptual GitHub artwork. A project license has not
yet been selected. Only allowlisted files belong in the public repository;
private local configuration and generated test artifacts remain outside the export.
