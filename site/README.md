# VirtualTissue portal

The portal presents two independent models. Gut keeps its four reviewed fixture examples and existing `player.html` links. `/gut/` is its dedicated page. `/lymph-node/` contains the static player built from the separately versioned LN repository and one real Jev recording. Playback never runs inference. This is website integration, not coupled gut-to-node biology.

## Pinned LN dependency

`site/tissues.json` records the exact LN commit and recording checksum. The Pages workflow checks out that commit into `_tissues/ln`, builds its static site, and copies only the public result. A later LN commit cannot change this website without an explicit portal update. The existing domain and DNS remain unchanged.

## Local preview

Clone `https://github.com/hylixinsights/VirtualTissue-LN.git` separately and check out the commit in `site/tissues.json`. Then:

```sh
python3 ../VirtualTissue-LN/scripts/build_site.py
python3 scripts/build_site.py --lymph-node-site ../VirtualTissue-LN/site
python3 -m http.server 8021 --bind 127.0.0.1 --directory site
```

Open http://127.0.0.1:8021/. The builder checks all four Gut fixture checksums and the pinned LN recording checksum. Public text distinguishes fixtures from actual Jev choices and discloses the LN fate-policy revision.

## Verification

`tests/site_browser.test.cjs` checks existing Gut recordings, responsive layouts and no external/API traffic. `tests/portal_browser.mjs` checks tissue navigation and the static LN landmarks under `/lymph-node/`. Set `SITE_URL` to the preview base. Playwright and a Chrome/Chromium browser are required.

## Publishing

The existing Pages workflow publishes only `site/` on updates to main. The LN repository has no competing deployment for this domain. Review the portal change before merging. No API key, Python server or private session folder is included in the website.

The original Gut illustrations remain conceptual AI artwork; the LN thumbnail is an actual rendered recorded frame. Neither is evidence of biological calibration.
