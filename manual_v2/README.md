# Intestinal virtual tissue package, version 2.0.0

Open `Intestinal_Cell_Decision_Manual_v2.docx` for the scientific manual. Open `INTEGRATION.md` for the operational instructions.

The executable entry points are `virtual_tissue_rules_v2.json` and `virtual_tissue_kernel.mjs`. Validate with `virtual_tissue_rules_v2.schema.json` and the kernel semantic checks.

Run `node test_kernel.mjs` and `node run_demo.mjs` to reproduce the software checks and one cell demonstration. No external JavaScript dependencies or model API are required. The tested Node version is recorded in `test_report.json`.

All numerical settings are proposed demonstration priors. The package does not contain a calibrated tissue model, measured patient cell initialization or a patched graphical simulator. Host physics must be connected explicitly.

`data_manifest.json` records source retrieval targets. `manual_content.json` is the editable content source of the manual. `manifest.json` records hashes of the final package files.
