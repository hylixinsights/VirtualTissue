#!/usr/bin/env python3
"""Build a static multi-tissue portal from reviewed recording players."""
from pathlib import Path
import gzip, hashlib, html, json, re, shutil, argparse
ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'site'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--lymph-node-site',type=Path,required=True);args=parser.parse_args()
    catalog=json.loads((ROOT/'recordings/examples/index.json').read_text(encoding='utf-8'))
    entries=catalog['recordings'] if isinstance(catalog,dict) else catalog
    assert [e['scenario']['id'] for e in entries]==['etec','epec','ibd','baseline']
    episodes=SITE/'episodes';episodes.mkdir(exist_ok=True)
    descriptions={
      'etec':('Enterotoxin exposure','Follow toxin exposure and the local ion and water secretion response.'),
      'epec':('Contact-driven injury','Explore bacterial attachment, brush-border damage and local responses.'),
      'ibd':('Focal innate inflammation','Trace a focal barrier lesion and the surrounding innate inflammatory response.'),
      'baseline':('The quiet control','An undisturbed tissue: no external input and no cellular questions.')}
    cards=[]
    for entry in entries:
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
    index=SITE/'index.html';source=index.read_text(encoding='utf-8')
    source=source.replace('Follow germinal-center formation, one physical division and three memory B cells. Actual recorded Jev choices, with a proposed fate-policy revision at 60 hours.','Follow an antigen-bearing dendritic cell through helper activation, linked B-cell help, plasmablast differentiation, plasma-cell maturation and IgM secretion. Actual recorded Jev choices under a proposed competing-fate policy.')
    source=source.replace('100 initial cells · 64 simulated hours · real Jev recording','120 initial cells · 4,953.7 simulated hours · 5,000 Jev calls · 4,922 IgM units')
    source=source.replace('100-cell lymph-node patch','120-cell lymph-node patch')
    source=re.sub(r'<!-- EPISODE_CARDS -->.*?<!-- /EPISODE_CARDS -->','<!-- EPISODE_CARDS -->',source,flags=re.S)
    source=source.replace('<!-- EPISODE_CARDS -->','<!-- EPISODE_CARDS -->'+''.join(cards)+'<!-- /EPISODE_CARDS -->')
    index.write_text(source,encoding='utf-8')
    gut=SITE/'gut/index.html';gut_source=gut.read_text(encoding='utf-8')
    gut_source=re.sub(r'<!-- EPISODE_CARDS -->.*?<!-- /EPISODE_CARDS -->','<!-- EPISODE_CARDS -->',gut_source,flags=re.S)
    gut_cards=''.join(cards).replace('href="player.html','href="../player.html').replace('href="episodes/','href="../episodes/').replace('src="assets/','src="../assets/')
    gut.write_text(gut_source.replace('<!-- EPISODE_CARDS -->','<!-- EPISODE_CARDS -->'+gut_cards+'<!-- /EPISODE_CARDS -->'),encoding='utf-8')
    ln=args.lymph_node_site.resolve();assert (ln/'index.html').is_file(), 'Build the pinned LN static site first'
    lock=json.loads((SITE/'tissues.json').read_text(encoding='utf-8'))['lymph_node']
    if (ln/'recording.json').is_file():
        ln_manifest=json.loads((ln/'recording.json').read_text(encoding='utf-8'))
        assert ln_manifest['sha256']==lock['recording_sha256'], 'LN recording differs from pinned portal manifest'
        assert ln_manifest['file']=='lymph-node-development.ln.json.gz'
    else:
        ln_catalog=json.loads((ln/'catalog.json').read_text(encoding='utf-8'));entry=ln_catalog['recordings'][0]
        assert entry['sha256']==lock['recording_sha256'], 'LN recording differs from pinned portal manifest'
    shutil.copytree(ln,SITE/'lymph-node',dirs_exist_ok=True)
    player=(ROOT/'player.html').read_text(encoding='utf-8')
    # The original standalone player keeps connect-src 'none'. Only this hosted copy
    # may fetch public same-origin assets, with a catalog allowlist in replay.js.
    player=player.replace("connect-src 'none'","connect-src 'self'").replace("script-src 'unsafe-inline'","script-src 'self' 'unsafe-inline'")
    player=player.replace('</head>','<link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><style>.site-return{display:block;padding:18px 24px;background:#091b2b;color:#70e0cf;text-decoration:none;font:15px system-ui}.player{margin-top:0}.player .stage{height:min(650px,65vh);min-height:300px}#error:empty{display:none}@media(max-width:760px){.player{padding:16px}.player .workspace{grid-template-columns:1fr}.player h1{font-size:24px}.player .stage{height:420px}.player .toolbar{gap:8px}}</style></head>')
    player=player.replace('<body>','<body><a class="site-return" href="./#experiments">← VirtualTissue · All experiments</a>')
    player=player.replace('</body>','<script src="replay.js"></script></body>')
    (SITE/'player.html').write_text(player,encoding='utf-8')
    shutil.copyfile(ROOT/'docs/manual.html',SITE/'manual.html')
    (SITE/'robots.txt').write_text('User-agent: *\nAllow: /\nSitemap: https://virtualtissue.org/sitemap.xml\n',encoding='utf-8')
    (SITE/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://virtualtissue.org/</loc></url><url><loc>https://virtualtissue.org/manual.html</loc></url><url><loc>https://virtualtissue.org/gut/</loc></url><url><loc>https://virtualtissue.org/lymph-node/</loc></url><url><loc>https://virtualtissue.org/lymph-node/model.html</loc></url></urlset>\n',encoding='utf-8')
    print('Built portal: four unchanged Gut fixtures and one reviewed Jev LN recording. Static playback only.')

if __name__=='__main__':main()
