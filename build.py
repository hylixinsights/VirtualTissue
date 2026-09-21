#!/usr/bin/env python3
"""Bundle local ES modules and JSON into an offline HTML with isolated scopes.

The original reference kernel remains unchanged. Only static single-line imports
and named declaration exports are supported by this deliberately small bundler.
"""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent
modules = {}
IMPORT = re.compile(r"^import (.*?) from ['\"](.*?)['\"](?: with \{.*?\})?;\s*$", re.M)
EXPORT = re.compile(r'\bexport (?:const|let|function|class) (\w+)')

def bundle(path):
    path = path.resolve()
    key = path.relative_to(ROOT).as_posix()
    if key in modules:
        return key
    source = path.read_text()
    if path.suffix == '.json':
        value = json.dumps(json.loads(source), separators=(',', ':'), ensure_ascii=True)
        modules[key] = f'{{default:{value}}}'
        return key
    names = EXPORT.findall(source)
    def replace(match):
        binding, relative = match.groups()
        dependency = bundle(path.parent / relative)
        if binding.startswith('{'):
            binding = re.sub(r'\s+as\s+', ':', binding)
            return f'const {binding}=__modules[{json.dumps(dependency)}];\n'
        return f'const {binding}=__modules[{json.dumps(dependency)}].default;\n'
    source = IMPORT.sub(replace, source)
    source = re.sub(r'\bexport (?=(?:const|let|function|class)\b)', '', source)
    modules[key] = f'(()=>{{\n{source}\nreturn {{{",".join(names)}}};\n}})()'
    return key

if __name__ == '__main__':
    import argparse
    from scripts.compile_pack import compile_pack
    parser = argparse.ArgumentParser()
    parser.add_argument('--pack')
    args = parser.parse_args()
    compile_pack(args.pack)
    import runpy
    runpy.run_path(str(ROOT/'scripts/build_manual.py'))
    for entry, template, output in [('app.mjs','template.html','Cellville_3D.html'),('player.mjs','player.html','player.html')]:
        modules.clear()
        bundle(ROOT / 'src' / entry)
        js = '(()=>{\n"use strict";\nconst __modules={};\n' + '\n'.join(
            f'__modules[{json.dumps(key)}]={value};' for key, value in modules.items()) + '\n})();'
        js = re.sub(r'</script', r'<\\/script', js, flags=re.I)
        page = (ROOT/'src'/template).read_text().replace('/*CSS*/', (ROOT/'src/ui.css').read_text()).replace('/*JS*/', js)
        (ROOT/output).write_text(page)
        print(f'Built {output}: {len(page.encode()):,} bytes from {len(modules)} local modules')
