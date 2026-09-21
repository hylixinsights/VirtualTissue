# VirtualTissue 6.1.0 — Manual v3 release

This release provides one manual-driven gut model, four scenarios, individual Jev
choices and data-only offline playback. The existing approved cell meshes remain
unchanged. New monocyte/DC meshes remain separate.

Changes include actionable, strict Choice validation; atomic malformed-response
regressions across server, host and browser; Manual v3 with primary sources and an
exact generated rule appendix; a shared supported-handler manifest; removal of the
sugar perturbation and its mechanism; four regenerated fixture episodes; a local
launcher without neighboring-project configuration; and a strict clean export.

No paid Jev call was used to prepare this release. Fixture behavior does not
validate live model decisions. The physical model remains uncalibrated and the
manual identifies omitted pathways. Original reference files remain unchanged
because current reference tests and inherited physical host layers depend on them.
Historical UI files, old verification reports and screenshots are excluded.

## Export and first commit

Run `python scripts/check_all.py` first, then `python scripts/package_release.py`.
The generated folder and ZIP contain the same allowlisted files; the manifest
records their SHA-256 values. The packager examines compressed fixture content as
well as plain text and excludes private recordings and local configuration.

Copy only the contents of `dist/VirtualTissue-6.1.0/` to a new empty directory.
Repeat installation/build/tests there before publication. The clean directory has
no `.git`, so a new first commit contains no development history. Create an empty
GitHub repository, then use its URL in place of the placeholder below:

```sh
git init -b main
git add .
git commit -m "Release VirtualTissue 6.1.0 with Manual v3"
git remote add origin YOUR_NEW_REPOSITORY_URL
git push -u origin main
```

Publishing is a separate action. No repository, remote, commit or push is created
by the build or export scripts. Never add the original working directory or its
private `.env` and recordings. Keep the generated release manifest for integrity
checks. A hash is not proof of authorship, licensing or scientific validity.
