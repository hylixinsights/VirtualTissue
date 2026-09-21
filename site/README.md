# VirtualTissue website

Static English landing page for `virtualtissue.org`. The site replays the four
reviewed fixture recordings. It does not run the simulation, load an API key,
contact Jev, collect analytics or depend on external fonts/scripts.

## Preview

From the repository root:

```sh
python3 scripts/build_site.py
python3 -m http.server 8080 --bind 127.0.0.1 --directory site
```

Open http://127.0.0.1:8080. Use HTTP for catalog auto-loading. The original
repository-root `player.html` still opens local files offline with networking
blocked. The hosted copy adds catalog-based loading via `?recording=etec`,
`epec`, `ibd` or `baseline`; legacy `?recording=episodes/<filename>` also works.
Only catalog files can be auto-loaded. No arbitrary URL is accepted.

## Build and verify

`scripts/build_site.py` verifies fixture checksums and metadata, generates the
cards using the catalog, copies the recordings and manual, and creates the hosted
player from the original offline artifact. It never imports the live app or
changes the original player. Run the script when the player or recordings change.
The page and images are self-contained and relative URLs work at the domain root
or under `/VirtualTissue/` on GitHub Pages.

With Playwright installed and the static preview running:

```sh
node tests/site_browser.test.cjs
```

Set `CHROMIUM_PATH` to an installed Chrome if needed. The browser check covers all
four URL-loaded episodes, play/pause, final frame seeking, cell inspection,
keyboard navigation, mobile layouts, local-file fallback, rejected external URLs,
resource errors and absence of external/API requests. `SITE_URL` overrides the
preview URL. Screenshots are written to the system temporary directory.

## GitHub Pages

The workflow `.github/workflows/pages.yml` publishes only `site/`, not the studio,
server, local environment or private recordings. In repository **Settings → Pages**,
select **GitHub Actions** as the source. Run the website workflow or merge a site
change into `main`.

Set **Custom domain** to `virtualtissue.org` in GitHub Pages. With Actions, the
`CNAME` file alone does not configure the domain; the repository setting is needed.
At the DNS provider, replace the apex parking records with four `A` records:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | hylixinsights.github.io |

After domain validation and certificate provisioning, enable **Enforce HTTPS**.
See [GitHub's custom domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## Artwork and provenance

`tissue-agents.webp` and `cell-agent.webp` are AI-generated conceptual artwork,
not microscopy, simulation output or evidence of biological validation. Originals
are preserved alongside the optimized WebP files. Prompts are in
`assets/ARTWORK.md`. The four `*-replay.webp` thumbnails are actual renders of the
bundled recordings at their final saved frames, with the appropriate signal view.
