# Tissue packs

`tissues/active.json` selects one pack for the studio, command-line recorder and
server. The pack is compiled and fingerprinted; the canonical API rejects a
browser or recorder built from a different pack. Restart the server after building.

1. Copy `tissues/ileum` to a new folder under `tissues`.
2. Edit `pack.json`: give it a new ID/title/version and point to your own versioned manual,
   registry, population, extension and scenario files inside this repository.
3. Provide a manual manifest with `version`, `supported_actions`, and the SHA-256
   of your registry (`registry_sha256`), following `manual_v3/model.json`. Point
   `manual_source` at it and `manual_document` at the human-readable manual.
   Run your registry schema validation and kernel cross-reference tests.
4. Edit `population.json`. Every row is one cell with a unique stable ID, geometry,
   manual type, position, reserve flag, health, resources, stores, outputs,
   competence, memory, programs and finite substrate inventories. Cell counts and
   manual identity mappings are read from this file by both host and server.
5. Edit `scenarios.json`: inputs use registered kinds and local coordinates, with
   independent default durations. A prompt is interpreted into these supported
   inputs; the preview states the interpretation. It is not an arbitrary biological
   program generated from unrestricted prose.
6. Choose the new path in `tissues/active.json`, run `python build.py`, then restart
   `python server.py --port 8000`. Run all tests and generate fixture recordings.

The `--pack tissues/my-tissue/pack.json` build option compiles a one-off selection.
For a persistent default, edit active.json. The CLI imports the generated pack;
there is no separate stale copy of the rules on the Jev server.

`extensions.json` appends action contracts and duration models without altering
original manual files. It cannot silently replace an original action. To change
existing rules, point your pack at your own explicitly versioned registry copy.
An action needs a real typed completion handler and the required host capabilities;
a JSON description alone does not make it executable. The engine checks local
gates, continuation, energy, exclusive targets and transactions before effects.

The default `ileum-cutaway-v1` adapter implements a 300 × 200 µm 2D physical slice
with a 3D illustration. It needs at least two epithelial boundary cells and supports
2–500 cells using the registered morphologies. Placement should remain consistent
with its luminal surface and compartments. Its chemistry, cell contact semantics,
barrier boundary and water transport are ileum specific. Parameters exposed in
`host_parameters` are genuinely consumed by this host; unknown overrides fail.

To add an organ or effect that these assumptions do not support, register a host
and renderer adapter in `scripts/compile_pack.py` and `src/tissue-pack.mjs`, supply
its geometry/fields/contact and completion code, and add contract tests. The
population format separates manual identity from appearance; the six original
morphologies are preserved and myeloid variants have separate meshes. Rendering
must read recorded frames without changing biological state.

The embedded pack in a recording freezes the applicable rules, population,
scenario definitions and parameters. Its fingerprint is checked by the player,
but a checksum is not a research validation certificate. Keep new numerical
assumptions labeled proposed until calibrated and independently validated.

## Required extension checklist

For liver, lung, skin or brain, specify the target species/site and evidence
labels, local sensing radius and compartments, initial cell identities and finite
inventories, perturbation inputs, signals with units/transport, eligible decisions,
clocks, cancellation and physical outcomes. Add actual code for each supported
action and host/renderer adapter. The default adapter deliberately rejects unknown
organs. Extend the compiler adapter registry when the implementation exists.

Add tests for quiet baseline (zero provider calls), locality, resource/target
ownership, clocks, conservation, failure atomicity, reset and scenario controls.
Create explicitly labeled fixture recordings for the new organ and ensure its
renderer reads frames without advancing biology. Validate the packaged export
with no private key. A pack cannot implement new tissue biology just by renaming
labels or permitting unsupported actions.
