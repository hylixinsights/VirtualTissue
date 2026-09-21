#!/usr/bin/env python3
"""Run every current VirtualTissue suite with fixture credentials, never paid Jev calls."""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-browser', action='store_true', help='Run only non-browser checks (not the complete suite).')
    parser.add_argument('--long-example', action='store_true', help='Also reproduce a 720-minute episode with a fixed-priority fixture.')
    args = parser.parse_args()
    if sys.version_info < (3, 12):
        parser.error('Use Python 3.12+ for development checks; the application server still supports Python 3.9+.')
    if not shutil.which('node'):
        parser.error('Node.js 22+ must be on PATH.')
    version = subprocess.check_output(['node', '--version'], text=True).strip()
    if int(version.lstrip('v').split('.')[0]) < 22:
        parser.error('Node.js 22+ is required.')
    for module in ['jsonschema'] + ([] if args.skip_browser else ['playwright']):
        if importlib.util.find_spec(module) is None:
            parser.error(f'Missing {module}. Install requirements-dev.txt with this Python interpreter.')
    env = os.environ.copy()
    env.pop('CELLVILLE_ENV_FILE', None)
    env.update(TYPESAFE_API_KEY='offline-fixture-not-a-real-key', JEV_MODEL='jev-1.13.0',
               JEV_BATCH_SIZE='20', JEV_MAX_ATTEMPTS='3', JEV_TIMEOUT_SECONDS='10',
               JEV_MAX_SESSION_CALLS='600', PYTHONUNBUFFERED='1')
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    if not env.get('CHROMIUM_PATH') and sys.platform == 'darwin' and chrome.is_file():
        env['CHROMIUM_PATH'] = str(chrome)
    python = sys.executable
    steps = [
        ['node', '--test', 'tests/engine.test.mjs', 'tests/manual_contract.test.mjs',
         'tests/manual_host.test.mjs', 'tests/ileum_host.test.mjs',
         'tests/v4_host.test.mjs', 'tests/v5_biology.test.mjs', 'tests/episodes.test.mjs'],
        [python, 'scripts/check_reference.py'],
        [python, 'tests/test_v4_server.py'],
        [python, 'tests/test_experiment_server.py'],
        [python, 'tests/test_server.py'],
        [python, 'tests/test_typesafe.py'],
        [python, 'tests/test_release.py'],
        ['node', 'scripts/reproduce.mjs'],
        ['node', 'scripts/reproduce_ileum.mjs', '--check'],
        [python, 'build.py'],
    ]
    if not args.skip_browser:
        steps += [[python, 'tests/v4_browser.test.py'], [python, 'tests/v5_browser.test.py'], [python, 'tests/episode_browser.test.py']]
    if args.long_example:
        steps.append(['node', 'scripts/reproduce_v5_fixture.mjs'])
    steps.append([python, 'scripts/package_release.py'])
    generated = ['Cellville_3D.html','player.html','docs/manual.html','tissues/compiled-pack.json']
    before = {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in generated}
    print('OFFLINE verification: fixture providers only; no real Jev key is passed to tests.', flush=True)
    for i, command in enumerate(steps, 1):
        print(f'\n[{i}/{len(steps)}] {" ".join(command)}', flush=True)
        result = subprocess.run(command, cwd=ROOT, env=env)
        if result.returncode:
            print('FAILED: stopped at the command above.', file=sys.stderr)
            return result.returncode
        if command[-1] == 'build.py':
            after = {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in generated}
            if after != before:
                print('FAILED: generated artifacts were stale; build.py updated it. Review it, then rerun.', file=sys.stderr)
                return 1
    print('\nPASS: all requested suites, reference reproductions, build and packaging completed. No paid Jev calls.', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
