#!/usr/bin/env python3
"""Export reviewed source and fixture-only recordings, without repository history."""
from pathlib import Path
import gzip
import hashlib
import json
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SECRET = re.compile(rb'apikey_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')

def scan(relative, content):
    if SECRET.search(content):
        raise RuntimeError(f'Credential-like content in {relative}; packaging stopped.')
    if re.search(rb'/(?:Users|home)/[A-Za-z0-9_.-]+/', content):
        raise RuntimeError(f'Machine-specific absolute path in {relative}; packaging stopped.')

def collect():
    names=json.loads((ROOT/'scripts/release_files.json').read_text())
    if (ROOT/'LICENSE').is_file():names.append('LICENSE')
    index=json.loads((ROOT/'recordings/examples/index.json').read_text())
    pack=json.loads((ROOT/'tissues/compiled-pack.json').read_text())
    if [r['scenario']['id'] for r in index] != ['etec','epec','ibd','baseline']:
        raise RuntimeError('Expected exactly four reviewed fixture examples.')
    runs=set()
    for item in index:
        file=item['file']
        if Path(file).name!=file or not file.endswith('.vt.json.gz'):raise RuntimeError('Invalid fixture path.')
        relative='recordings/examples/'+file
        raw=gzip.decompress((ROOT/relative).read_bytes());scan(relative,raw)
        envelope=json.loads(raw);payload=envelope['payload']
        if hashlib.sha256(payload.encode()).hexdigest()!=envelope['sha256']:raise RuntimeError('Fixture checksum mismatch.')
        e=json.loads(payload);m=e['metadata']
        if m['provider']!='fixture' or m['calls']!=0 or m['status']!='complete':raise RuntimeError('Only complete zero-call fixtures may be released.')
        if m['pack_fingerprint']!=pack['fingerprint'] or e['pack']!=pack:raise RuntimeError('Fixture uses a stale tissue pack.')
        if m['scenario']!=item['scenario'] or m['run_id'] in runs:raise RuntimeError('Invalid fixture provenance.')
        runs.add(m['run_id']);names.append(relative)
    result={}
    for name in sorted(names):
        path=ROOT/name;relative=Path(name)
        if relative.is_absolute() or '..' in relative.parts or not path.is_file() or path.is_symlink():raise RuntimeError('Invalid release allowlist entry: '+name)
        if any(p in {'.git','.venv','node_modules','__pycache__','runs','dist'} for p in relative.parts) or (relative.name.startswith('.env') and relative.name!='.env.example'):raise RuntimeError('Forbidden release file: '+name)
        content=path.read_bytes();scan(name,content)
        if path.suffix=='.docx':
            with zipfile.ZipFile(path) as z:
                for entry in z.namelist():scan(name+':'+entry,z.read(entry))
        result[name]=content
    return result

def main():
    files=collect() # Validate everything before replacing a previous successful export.
    version=json.loads((ROOT/'package.json').read_text())['version']
    base=ROOT/'dist';target=base/f'VirtualTissue-{version}';archive=base/f'VirtualTissue-{version}.zip'
    if target.exists():shutil.rmtree(target)
    target.mkdir(parents=True)
    for name,content in files.items():
        dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(content)
        if dest.suffix=='.command':dest.chmod(0o755)
    manifest={'version':version,'manual':'3.0.0','live_jev_calls':0,'sha256':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}}
    (target/'RELEASE_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for path in sorted(target.rglob('*')):
            if path.is_file():
                info=zipfile.ZipInfo(path.relative_to(base).as_posix(),date_time=(2026,9,21,0,0,0))
                info.external_attr=(0o100755 if path.suffix=='.command' else 0o100644)<<16
                info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,path.read_bytes())
    print(target);print(archive);print(f'{len(files)} allowlisted files. No history, local configuration, caches or private runs.')

if __name__=='__main__':main()
