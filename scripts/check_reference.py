#!/usr/bin/env python3
"""Validate authoritative source identity/schema and test a temporary kernel copy."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import tempfile
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
reference = ROOT/'manual_v2'
manifest = json.loads((reference/'manifest.json').read_text())
for entry in manifest['files']:
    data = (reference/entry['path']).read_bytes()
    assert len(data) == entry['bytes'], entry['path']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['path']
rules = json.loads((reference/'virtual_tissue_rules_v2.json').read_text())
assert hashlib.sha256((reference/'virtual_tissue_rules_v2.json').read_bytes()).hexdigest() == 'db6bac825389a9d99957ddc425be355a1b50fd48571260e748f5e0b6f17078be'
schema = json.loads((reference/'virtual_tissue_rules_v2.schema.json').read_text())
Draft202012Validator.check_schema(schema)
Draft202012Validator(schema).validate(rules)
print('PASS original file hashes and JSON Schema 2020-12', flush=True)
with tempfile.TemporaryDirectory(prefix='cellville-reference-') as temp:
    target = Path(temp)/'manual_v2'
    shutil.copytree(reference, target)
    subprocess.run(['node', 'test_kernel.mjs'], cwd=target, check=True)
    report = json.loads((target/'test_report.json').read_text())
    assert report['passed'] == 43 and report['failed'] == 0
