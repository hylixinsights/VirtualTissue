#!/usr/bin/env python3
"""Build a static, fixture-only GitHub Pages site from the reviewed offline player."""
from pathlib import Path
import gzip, hashlib, html, json, re, shutil
ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'site'

def main():
    catalog=json.loads((ROOT/'recordings/examples/index.json').read_text())
    assert [e['scenario']['id'] for e in catalog]==['etec','epec','ibd','baseline']
    episodes=SITE/'episodes';episodes.mkdir(exist_ok=True)
    descriptions={
      'etec':('Enterotoxin exposure','Follow toxin exposure and the local ion and water secretion response.'),
      'epec':('Contact-driven injury','Explore bacterial attachment, brush-border damage and local responses.'),
      'ibd':('Focal innate inflammation','Trace a focal barrier lesion and the surrounding innate inflammatory response.'),
      'baseline':('The quiet control','An undisturbed tissue: no external input and no cellular questions.')}
    cards=[]
    for entry in catalog:
        name=entry['file'];assert Path(name).name==name and name.endswith('.vt.json.gz')
        raw=(ROOT/'recordings/examples'/name).read_bytes();envelope=json.loads(gzip.decompress(raw));payload=envelope['payload']
        assert hashlib.sha256(payload.encode()).hexdigest()==envelope['sha256']
        episode=json.loads(payload);m=episode['metadata'];assert m==entry or all(m.get(k)==v for k,v in entry.items() if k not in ('bytes','file'))
        assert m['provider']=='fixture' and m['calls']==0 and m['status']=='complete'
        (episodes/name).write_bytes(raw)
        sid=m['scenario']['id'];label='IBD-like' if sid=='ibd' else ('Baseline' if sid=='baseline' else sid.upper())
        kicker,description=descriptions[sid];href=f'player.html?recording={sid}'
        cards.append(f'''<article class="episode"><a class="episode-image" href="{href}" aria-label="Replay {label}"><img src="assets/{sid}-replay.webp" width="600" height="400" loading="lazy" alt="Recorded {label} tissue state in the VirtualTissue player"><span class="episode-tag">Recorded experiment</span></a><div class="episode-content"><p class="episode-kicker">{kicker}</p><h3>{label}</h3><p class="episode-description">{description}</p><p class="episode-meta"><span>{m['duration_min']} biological min</span><span>{m['cell_questions']:,} decisions</span></p><a class="episode-launch" href="{href}">Watch experiment <span aria-hidden="true">↗</span></a><a class="episode-download" href="episodes/{name}" download>Download recording · {len(raw)/1000000:.1f} MB</a></div></article>''')
    shutil.copyfile(ROOT/'recordings/examples/index.json',episodes/'index.json')
    shutil.copyfile(ROOT/'recordings/examples/README.md',episodes/'README.md')
    index=SITE/'index.html';source=index.read_text()
    source=re.sub(r'<!-- EPISODE_CARDS -->.*?<!-- /EPISODE_CARDS -->','<!-- EPISODE_CARDS -->',source,flags=re.S)
    source=source.replace('<!-- EPISODE_CARDS -->','<!-- EPISODE_CARDS -->'+''.join(cards)+'<!-- /EPISODE_CARDS -->')
    index.write_text(source)
    player=(ROOT/'player.html').read_text()
    # The original standalone player keeps connect-src 'none'. Only this hosted copy
    # may fetch public same-origin assets, with a catalog allowlist in replay.js.
    player=player.replace("connect-src 'none'","connect-src 'self'").replace("script-src 'unsafe-inline'","script-src 'self' 'unsafe-inline'")
    player=player.replace('</head>','<link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><style>.site-return{display:block;padding:18px 24px;background:#091b2b;color:#70e0cf;text-decoration:none;font:15px system-ui}.player{margin-top:0}.player .stage{height:min(650px,65vh);min-height:300px}#error:empty{display:none}@media(max-width:760px){.player{padding:16px}.player .workspace{grid-template-columns:1fr}.player h1{font-size:24px}.player .stage{height:420px}.player .toolbar{gap:8px}}</style></head>')
    player=player.replace('<body>','<body><a class="site-return" href="./#experiments">← VirtualTissue · All experiments</a>')
    player=player.replace('</body>','<script src="replay.js"></script></body>')
    (SITE/'player.html').write_text(player)
    shutil.copyfile(ROOT/'docs/manual.html',SITE/'manual.html')
    (SITE/'robots.txt').write_text('User-agent: *\nAllow: /\nSitemap: https://virtualtissue.org/sitemap.xml\n')
    (SITE/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://virtualtissue.org/</loc></url><url><loc>https://virtualtissue.org/manual.html</loc></url></urlset>\n')
    print('Built site/: four verified fixtures, offline player and manual. No live provider code added.')

if __name__=='__main__':main()
