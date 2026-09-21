# VirtualTissue 6.1.1 — Focal injury and local signal visibility

VirtualTissue was conceived and created by **Helder Nakaya**, leader of
[CSBL](https://csbiology.org) and founder of [Hylix.app](https://hylix.app).
Helder developed the entire project with ChatGPT and Claude as AI collaborators,
using Jev from TypeSafe for individual cellular decisions. See [Credits](../CREDITS.md).

## Changes since 6.1.0

- Tissue injury now directly reduces epithelial health within a local wound.
  The core reaches health 20 and 80% cell damage; the effect tapers toward the
  edge. Distant cells retain their original health. The profile is a documented,
  configurable demonstration prior, not an experimentally calibrated severity.
- Injury creates a local damage cue and uses existing manual repair/death gates
  and clocks. It does not inject cytokines or enterotoxins, or kill instantly.
- Applying Tissue injury focuses the damaged core and selects Cell damage.
  Separate barrier, cell damage, LT and ST readouts expose the affected cells.
- LT/ST fields and per-cell exposure rings are visible in the Studio and offline
  player. Older recordings without toxin grids retain their recorded cell values.
- Manual documentation and all four independent fixture recordings were updated.
- Creator credits, software citation metadata and conceptual GitHub artwork were
  added. The six original cell morphologies remain unchanged.

The complete offline suite passes 378 named checks, including real WebGL browser
and offline-player tests. No paid Jev calls were used. These checks verify software
behavior; the physical model remains uncalibrated. See [Verification](VERIFICATION.md).

## Prepare the GitHub release

Run `python scripts/check_all.py`, then `python scripts/package_release.py`.
The generated `dist/VirtualTissue-6.1.1/` folder and ZIP contain only allowlisted
files, fixture recordings and a SHA-256 manifest. Publish that export only.

The existing `v6.1.0` tag identifies the previous version. Use the new `v6.1.1`
tag for this update and attach `VirtualTissue-6.1.1.zip` when creating its GitHub
release. The changes and creator-credit paragraphs above can be used as release
notes. Build and packaging scripts do not publish releases.

The export excludes development history, private recordings, local `.env`, caches
and generated test screenshots. Keep the manifest with the distribution. Its
hashes check file integrity, not authorship, licensing or scientific validity.
