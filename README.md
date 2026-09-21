# VirtualTissue / Cellville3D

A reproducible gut tissue simulation studio with individual Jev / TypeSafe AI
choices, executable Manual v3 constraints, local sensing and complete offline
recordings. The model is an **uncalibrated mechanistic demonstration**. AI choice
probabilities are not biological event rates.

The four scenarios are **ETEC**, **EPEC**, **IBD-like innate injury** and **quiet
baseline**. The studio has one manual-driven model. Quiet cells make no API calls;
locally activated cells choose only from actions permitted by the manual.

## Install and run

The server uses the Python standard library (Python 3.9+). Node.js 22+ is required
for the command-line recorder and development checks. No npm install is needed.
Clone your published repository, enter its directory, and run:

```sh
python3 server.py --port 8000
```

Enter **your own TypeSafe API key** in the hidden terminal prompt. Open
[the local studio](http://127.0.0.1:8000). On macOS you can instead double-click
`Start Cellville.command`. The launcher uses only this project's configuration.

For persistent local configuration, copy `.env.example` to `.env` and edit it
locally to set `TYPESAFE_API_KEY`; alternatively set it in your process environment.
Never paste keys into the studio, scenarios, recordings, Git or command arguments.
`.env` is ignored and never served. Restart the server after changing configuration.
The configuration badge checks local settings only and makes no paid request.

Choose a scenario, duration and request budget, then **Start recording**. Inspect
cells for local readings, permitted/blocked actions, probability distributions and
biological clocks. Use **Stop & save recording**, then **Discard & reset** before
the next scenario. The server defaults to a 600-request session cap; the studio
uses 100 requests per experiment. Batches and retries count, so a request budget
is not a token or monetary budget. No failed response falls back to a local policy.

## Test without paid calls

Generate four independent demonstrations without a key or server:

```sh
node scripts/record_experiments.mjs --provider fixture \
  --scenarios etec,epec,ibd,baseline --output recordings/runs
```

These are explicitly labeled **fixtures**, not real Jev responses. The bundled
[example recordings](recordings/examples/README.md) use the same fixture policy.

For the full test suite (Python 3.12+ and Node.js 22+):

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python build.py
python scripts/check_all.py
```

The suite uses synthetic upstream responses, never paid inference. It checks the
reference kernel, Manual v3 schema, host biology, invalid probabilities, budgets,
recording integrity, real WebGL studio, offline playback, reproducible builds and
clean packaging. On macOS installed Chrome can be used by the test runner.

## Deliberate live test and bounded recording

Only run these commands when you intend to use your own paid key. This synthetic
connection test makes **at most one** upstream request, without retry or tissue
changes:

```sh
python3 server.py --check-jev
```

For a live scenario, first start the server, then explicitly select Jev:

```sh
node scripts/record_experiments.mjs --provider jev \
  --server http://127.0.0.1:8000 --scenarios etec \
  --duration-min 60 --max-calls 10 --output recordings/runs
```

The 10-request limit includes retries and every HTTP batch. Reaching the limit
saves a **partial** recording and returns exit code 2. Each scenario in a batch
has its own budget and reset. Recordings under `recordings/runs` remain private.
A timeout can leave usage unknown; that is recorded rather than reported as free.

## Replay offline

Open **player.html** directly in a modern browser and load a `.vt.json.gz` file.
No server, key, internet or tokens are needed. Play, seek and inspect every saved
cell decision. The player reads recorded states only; it cannot run the simulation
or call Jev. Every decision round is saved independently of visual frame sampling.

Each episode contains initial/final states, sampled visual frames, all queried
cells' local snapshots, legal options, returned probabilities and choices, event
clocks, physical completion receipts, failure audit and usage. A fresh run has an
independent ID and empty ledgers. Default recording memory limit is 128 MiB; the
portable archive limit is 256 MiB. No old frames or decisions are silently dropped.

## Manual and extending the model

- [Manual v3](manual_v3/Manual_v3.md) and [printable manual with exact rule appendix](docs/manual.html).
- [Machine-readable constraints](manual_v3/constraints.json), [schema](manual_v3/constraints.schema.json), [supported mechanisms](manual_v3/model.json) and [kernel](manual_v3/kernel.mjs).
- [Active gut tissue pack](tissues/ileum/pack.json), [population](tissues/ileum/population.json) and [compiled pack](tissues/compiled-pack.json).
- [Create liver, lung, skin, brain or another tissue](docs/TISSUE_PACKS.md).
- [Local testing and protocol diagnostics](docs/LOCAL_TESTING.md).
- [Release notes and clean export](docs/RELEASE.md).

There are 22 physical handlers among 56 rule contracts. Missing mechanisms stay
blocked. NF-kB is not explicitly simulated; inflammasome activation, mature IL-1
beta release and type I interferon signaling are not implemented. Dendritic
presentation is a coarse uptake/processing/display model without T-cell priming.
Death is conditional and unclassified. Monocyte adaptation takes biological days.
All numerical settings remain proposed. Manual v3 provides primary citations and
identifies these simplifications. The immutable `manual_v2` files are required
reference/kernel tests, not a user-selectable mode.

## Clean public export

```sh
python3 scripts/package_release.py
```

Publish the contents of `dist/VirtualTissue-6.1.0/` into a new empty repository.
The export has a strict file allowlist, SHA-256 manifest, fixture-only recordings
and no Git history, `.env`, private runs, caches or historical browser artifacts.
Do not copy this working checkout wholesale. See the release guide for validation
and first-commit commands.

[Verification record](docs/VERIFICATION.md). Project license: not yet specified.
