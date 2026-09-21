#!/usr/bin/env python3
"""Render Manual v3 and exact active rule contracts without external dependencies."""
from pathlib import Path
from html import escape
import json
import re
ROOT = Path(__file__).resolve().parents[1]
pack = json.loads((ROOT/'tissues/compiled-pack.json').read_text())
source = (ROOT/pack['source_pack']).parent/pack['definition']['manual_document']

def inline(s):
    s = escape(s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    return re.sub(r'https://[^\s<]+', lambda m: '<a href="'+m[0]+'">'+m[0]+'</a>', s)

def markdown(text):
    out=[];paragraph=[];table=False
    def flush():
        if paragraph: out.append('<p>'+inline(' '.join(paragraph))+'</p>');paragraph.clear()
    for line in text.splitlines()+['']:
        if line.startswith('|'):
            flush()
            if not table:out.append('<table>');table=True
            if re.match(r'^\|[ :|\-]+\|$',line):continue
            out.append('<tr>'+''.join('<td>'+inline(v.strip())+'</td>' for v in line.strip('|').split('|'))+'</tr>')
            continue
        if table:out.append('</table>');table=False
        if line.startswith('#'):
            flush();level=len(line)-len(line.lstrip('#'));out.append(f'<h{level}>'+inline(line[level:].strip())+f'</h{level}>')
        elif not line.strip():flush()
        else:paragraph.append(line)
    return ''.join(out)

rules=pack['registry'];supported=set(pack['manual']['supported_actions'])
body=markdown(source.read_text())
body+='<h2>Executable action appendix</h2><p>These contracts are rendered directly from the active registry. Supported means a handler exists; all other gates still apply.</p>'
for action in rules['actions']:
    status='Supported host handler' if action['id'] in supported else 'Blocked: physical handler unavailable'
    body+=f'<section class="action" id="{escape(action["id"])}"><h3>{escape(action["id"])}</h3><p>{status}</p><details><summary>Exact predicates, resources, clocks and outcomes</summary><pre>'+escape(json.dumps(action,indent=2))+'</pre></details></section>'
for name in ['duration_models','parameters']:
    body+='<h2>'+name.replace('_',' ').title()+'</h2><pre>'+escape(json.dumps(rules[name],indent=2))+'</pre>'
page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manual v3 — Gut tissue</title><style>
body{font:16px/1.65 system-ui,sans-serif;color:#173d38;background:#f4f3e9;margin:0}main{max-width:1050px;margin:auto;padding:32px}h1,h2,h3{line-height:1.3}h2{margin-top:2em}table{border-collapse:collapse;width:100%;font-size:14px;background:white}td{border:1px solid #bacbc3;padding:10px}tr:first-child{font-weight:bold}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace;background:white;padding:12px}a{color:#176c5a;overflow-wrap:anywhere}section{border-top:1px solid #bacbc3;padding:12px 0}code{overflow-wrap:anywhere}@media print{body{background:white}main{padding:0}h2,h3{break-after:avoid}tr{break-inside:avoid}details::details-content{display:block}p{orphans:3;widows:3}}@page{size:A4;margin:18mm}
</style></head><body><main>'''+body+'</main></body></html>'
(ROOT/'docs/manual.html').write_text(page)
print(f'Rendered Manual v3 with {len(rules["actions"])} exact action contracts and all parameters.')
