# Offline fixture recordings

These four files are deterministic-policy demonstrations, not live Jev responses
or scientific validation. Each was generated from a fresh baseline with the same
seed and its own run ID: ETEC (180 min), EPEC (360 min), IBD-like innate injury
(360 min), and baseline (60 min). All have zero paid API calls.

Open `player.html` directly in your browser and choose a file. The player visibly
labels fixture provenance. Inspect exact local observations, options, returned
fixture probabilities, selected actions and physical completion receipts. The
quiet baseline has no cellular decisions. Other outcomes depend on fixture policy
and the model's uncalibrated clocks; they are not promises about live Jev output.

Reproduce with `node scripts/record_experiments.mjs --provider fixture --scenarios
etec,epec,ibd,baseline --output recordings/runs`. Run IDs/timestamps differ between
runs; compare physical trajectories and decisions rather than archive hashes.
Private live recordings never belong in this directory.
