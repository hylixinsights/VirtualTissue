#!/usr/bin/env python3
"""Cellville's loopback-only TypeSafe/Jev adapter, Python standard library only.

The TypeSafe skill and live HTTP API were reviewed on 2026-09-19.
Credentials never enter the browser. Remote results are validated before any
physical simulation state is committed by the browser engine.
"""
from __future__ import annotations

import argparse
import getpass
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent
VERSION = '6.1.1'
ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
CONTRACT = 'cellville.typesafe.choice.v1'
ENV_NAMES = {
    'TYPESAFE_API_KEY', 'JEV_MODEL', 'JEV_BATCH_SIZE', 'JEV_MAX_ATTEMPTS',
    'JEV_TIMEOUT_SECONDS', 'JEV_MAX_SESSION_CALLS',
}


def load_local_env(path: Path, environ=None) -> None:
    """Read literal KEY=value settings. Never evaluate or source shell code.

    Existing process environment wins. A local .env is optional and is never
    served by HTTP. No arbitrary variable expansion, multiline values or exports.
    """
    target = os.environ if environ is None else environ
    if not path.is_file():
        return
    if path.stat().st_size > 16384:
        raise ValueError('Local .env exceeds 16 KB.')
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        name, sep, value = line.partition('=')
        name, value = name.strip(), value.strip()
        if not sep or name not in ENV_NAMES:
            raise ValueError('Unsupported setting in .env. Use .env.example as the template.')
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError('Unclosed quote in .env.')
            value = value[1:-1]
        if '\x00' in value or '\n' in value or '\r' in value:
            raise ValueError('Invalid .env value.')
        if value and name not in target:
            target[name] = value


load_local_env(ROOT / '.env')
# An explicit launcher configuration reference avoids copying an existing key.
if os.environ.get('CELLVILLE_ENV_FILE'):
    load_local_env(Path(os.environ['CELLVILLE_ENV_FILE']))


def setting_int(name, default, lo, hi):
    value = int(os.environ.get(name, str(default)))
    if not lo <= value <= hi:
        raise ValueError(f'{name} must be between {lo} and {hi}.')
    return value


MODEL = os.environ.get('JEV_MODEL', 'jev-1.13.0').strip()
if not re.fullmatch(r'jev-[A-Za-z0-9][A-Za-z0-9._-]{0,70}', MODEL):
    raise ValueError('JEV_MODEL must be a compatible Jev model identifier.')
KEY = os.environ.get('TYPESAFE_API_KEY', '').strip()
if any(ord(c) < 32 for c in KEY):
    raise ValueError('Invalid API credential format.')
BATCH_SIZE = setting_int('JEV_BATCH_SIZE', 20, 1, 100)
MAX_ATTEMPTS = setting_int('JEV_MAX_ATTEMPTS', 3, 1, 3)
REQUEST_TIMEOUT = setting_int('JEV_TIMEOUT_SECONDS', 10, 1, 20)
MAX_SESSION_CALLS = setting_int('JEV_MAX_SESSION_CALLS', 600, 1, 100000)
ROUND_TIMEOUT = 45
MAX_REQUEST_BYTES = 48000  # Conservative application cap, not a token estimate.
ROUND_LOCK = threading.Lock()
SESSION_LOCK = threading.Lock()
SESSION = {'calls': 0, 'inputTokens': 0, 'outputTokens': 0, 'unknownUsageCalls': 0}

MENUS = {
    'enterocyte': {'maintain', 'reinforce', 'alarm', 'recruit', 'apoptosis'},
    'goblet': {'maintain', 'mucus', 'alarm', 'apoptosis'},
    'fibroblast': {'rest', 'matrix', 'repair', 'cytokine'},
    'macrophage': {'patrol', 'migrate', 'phagocytose', 'debris', 'recruit', 'cytokine', 'repair'},
    'neutrophil': {'rest', 'patrol', 'migrate', 'phagocytose', 'cytokine', 'apoptosis', 'enter'},
    'nk': {'rest', 'patrol', 'migrate', 'attack', 'cytokine'},
}
DESCRIPTIONS = {
    'maintain': 'Maintain this epithelial cell and its local junction; quiet upkeep, no alarm.',
    'reinforce': 'Tighten this weakened or stressed epithelial junction without secreting alarm.',
    'mucus': 'Secrete protective mucus to limit pathogen contact at this goblet cell.',
    'alarm': 'Release local danger and chemokine signals when a threat or injury is sensed.',
    'recruit': 'Release a chemokine asking nearby immune cells for help with local danger.',
    'apoptosis': 'Remove this severely damaged cell from the active tissue. This is irreversible.',
    'rest': 'Conserve energy without secretion, movement or damage.',
    'patrol': 'Survey the tissue by moving a short distance, without attacking or secreting.',
    'migrate': 'Move along the already computed local chemokine gradient toward help signals.',
    'phagocytose': 'Reduce pathogen that is already within reach of this cell.',
    'debris': 'Clear a dead cell already within reach; not an attack on a living cell.',
    'cytokine': 'Release a local inflammatory signal. This may amplify tissue damage.',
    'repair': 'Apply repair factors to local damage and living cells. Never regenerate a dead cell.',
    'matrix': 'Add repair material at a nearby weak junction or gap; do not make a new cell.',
    'attack': 'Damage an already marked stressed epithelial target within reach.',
    'enter': 'Leave the existing vascular reserve and enter tissue in response to local signals.',
}
LEVELS = {'absent', 'low', 'moderate', 'high'}
HEALTH = {'critical', 'damaged', 'stressed', 'healthy'}
BOOLEAN_FIELDS = {'reserve', 'nearbyGap', 'nearbyStressedCell', 'reachableMarkedTarget', 'reachableDebris', 'gradientAvailable'}
LEVEL_FIELDS = {'energy', 'pathogen', 'danger', 'chemokine', 'cytokine', 'junctionDamage'}


class ProviderError(Exception):
    def __init__(self, message, meta=None):
        super().__init__(message)
        self.meta = meta or {'calls': 0, 'inputTokens': 0}


def validate_payload(data: Any) -> dict:
    if not isinstance(data, dict):
        raise ValueError('Expected an object.')
    for key in ('tick', 'revision'):
        if type(data.get(key)) is not int or not 0 <= data[key] <= 2**53 - 1:
            raise ValueError(f'Invalid {key}.')
    cells = data.get('cells')
    if not isinstance(cells, list) or len(cells) > len(ACTIVE_PACK['population']):
        raise ValueError('Too many cells for this tissue pack.')
    ids, cleaned = set(), []
    for c in cells:
        if (not isinstance(c, dict) or type(c.get('id')) is not int
                or not 0 <= c['id'] < 100 or c['id'] in ids):
            raise ValueError('Invalid or duplicate cell ID.')
        ids.add(c['id'])
        typ, actions = c.get('type'), c.get('actions')
        if not isinstance(typ, str) or typ not in MENUS:
            raise ValueError('Unsupported cell type.')
        if (not isinstance(actions, list) or not 2 <= len(actions) <= 9
                or any(not isinstance(a, str) or a not in MENUS[typ] for a in actions)
                or len(set(actions)) != len(actions)):
            raise ValueError('Invalid action menu.')
        obs = c.get('observation')
        if not isinstance(obs, dict) or len(json.dumps(obs, allow_nan=False)) > 4000:
            raise ValueError('Invalid local observation.')
        if obs.get('type', typ) != typ:
            raise ValueError('Cell type and observation disagree.')
        safe = {'type': typ}
        for k, v in obs.items():
            if k == 'health':
                if not isinstance(v, str) or v not in HEALTH:
                    raise ValueError('Invalid health label.')
                safe[k] = v
            elif k in LEVEL_FIELDS or k == 'junction':
                # Accept the old junction key, but give damage an unambiguous name.
                if not isinstance(v, str) or v not in LEVELS | {'not applicable'}:
                    raise ValueError('Invalid local signal label.')
                safe['junctionDamage' if k == 'junction' else k] = v
            elif k in BOOLEAN_FIELDS:
                if type(v) is not bool:
                    raise ValueError('Invalid local boolean.')
                safe[k] = v
            elif k == 'neighbors':
                if not isinstance(v, list) or len(v) > 3:
                    raise ValueError('Expected at most three local neighbors.')
                near = []
                for neighbor in v:
                    if not isinstance(neighbor, dict) or neighbor.get('type') not in MENUS:
                        raise ValueError('Invalid neighbor type.')
                    damage = neighbor.get('damage', neighbor.get('health', 'absent'))
                    status = neighbor.get('status', 'unmarked')
                    if not isinstance(damage, str) or damage not in LEVELS or status not in ('marked stress', 'unmarked'):
                        raise ValueError('Invalid neighbor observation.')
                    near.append({'type': neighbor['type'], 'damage': damage, 'status': status})
                safe[k] = near
            # Unknown fields, including a global event prompt or a whole map, do not pass.
        cleaned.append({'id': c['id'], 'type': typ, 'actions': list(actions), 'observation': safe})
    return {'tick': data['tick'], 'revision': data['revision'], 'cells': cleaned}


def build_request(cells: list[dict], model: str | None = None) -> dict:
    return {
        'model': model or MODEL,
        'state': {
            'setting': 'An illustrative intestinal tissue game, not a medical or biological predictor.',
            'rules': ('Choose locally within the supplied action menu. Preserve tissue and resources when '
                      'no threat is present. The engine has computed all counts, distances, timing, '
                      'gradients and legal actions. Do not invent targets or knowledge of the rest of the tissue.'),
            'labels': ('Signal levels are absent, low, moderate or high. Health describes the cell itself. '
                       'junctionDamage and neighbor damage are damage, not good health. '
                       'nearbyGap includes weakened nearby junctions. Each question is one independent cell.'),
        },
        'questions': {
            f'cell_{c["id"]}': {
                'type': 'choice',
                'instructions': {
                    'task': 'Select the next legal action for this single cell using only local_observation.',
                    'local_observation': c['observation'],
                },
                'criteria': {a: DESCRIPTIONS[a] for a in c['actions']},
            } for c in cells
        },
    }



# V4 uses the same fixed manual action identifiers as the browser kernel.
ACTIVE_PACK = json.loads((ROOT / 'tissues' / 'compiled-pack.json').read_text())
V4_REGISTRY = ACTIVE_PACK['registry']
V4_ACTIONS = {a['id']: a for a in V4_REGISTRY['actions']}
V4_TYPES = {'macrophage': 'resident_macrophage'}
V4_CONTRACT = 'cellville.unified.5.0.0'
V4_NUMBERS = {'energy', 'health', 'TNF', 'CXCL8', 'PAMP', 'DAMP', 'nearby_pathogens',
              'nearby_altered_cells', 'nearby_barrier_damage', 'gradient', 'alarm_memory', 'CCL2', 'damage', 'antigen_count', 'presented_count'}
V4_REASONS = {'Nearby pathogen', 'Local microbial products', 'Local damage signal',
              'Nearby barrier injury', 'Altered neighboring cell', 'Own injury',
              'Internalized cargo', 'Local TNF', 'Local CXCL8', 'Local CCL2', 'Acquired antigen', 'Post-recruitment adaptation', 'Local enterotoxin'}

def validate_v4_payload(data):
    if not isinstance(data, dict) or data.get('contract') != V4_CONTRACT:
        raise ValueError('Unsupported tissue contract.')
    if data.get('pack_fingerprint', ACTIVE_PACK['fingerprint']) != ACTIVE_PACK['fingerprint']:
        raise ValueError('Tissue pack mismatch. Rebuild the application and restart the server.')
    if type(data.get('call_limit', 10000)) is not int or not 0 <= data.get('call_limit', 10000) <= 10000:
        raise ValueError('Invalid remaining request limit.')
    if not isinstance(data.get('run_id'), str) or not 1 <= len(data['run_id']) <= 100:
        raise ValueError('Invalid run ID.')
    for key in ('tick', 'revision', 'time_min'):
        if type(data.get(key)) is not int or not 0 <= data[key] <= 2**53 - 1:
            raise ValueError('Invalid tissue epoch.')
    cells = data.get('cells')
    if not isinstance(cells, list) or len(cells) > len(ACTIVE_PACK['population']):
        raise ValueError('Too many cells for this tissue pack.')
    cleaned, ids = [], set()
    for c in cells:
        if not isinstance(c, dict) or type(c.get('id')) is not int or not 0 <= c['id'] < len(ACTIVE_PACK['population']) or c['id'] in ids:
            raise ValueError('Invalid or duplicate cell ID.')
        ids.add(c['id']); typ = c.get('type')
        obs = c.get('observation')
        manual_type = obs.get('manual_type') if isinstance(obs, dict) else None
        expected = {'resident_macrophage','inflammatory_monocyte','dendritic'} if typ == 'macrophage' else {typ}
        if 'pack_fingerprint' not in data and manual_type not in expected:
            raise ValueError('Cell morphology and manual identity disagree.')
        if 'pack_fingerprint' in data:
            row = ACTIVE_PACK['population'][c['id']]
            if typ != row['morphology'] or manual_type != row['manual_type']:
                raise ValueError('Cell identity differs from the configured population.')
        if typ not in MENUS or manual_type not in V4_REGISTRY['cell_types']:
            raise ValueError('Unknown cell type.')
        actions = c.get('actions')
        licensed = (set(V4_REGISTRY['cell_types'][manual_type]['allowed_actions']) & set(ACTIVE_PACK['manual']['supported_actions'])) | {'WAIT'}
        if not isinstance(actions, list) or not 2 <= len(actions) <= 30 or any(not isinstance(a, str) or a not in licensed for a in actions) or len(set(actions)) != len(actions) or 'WAIT' not in actions:
            raise ValueError('Invalid manual action menu.')
        obs = c.get('observation')
        if not isinstance(obs, dict) or obs.get('manual_type') != manual_type:
            raise ValueError('Invalid cell observation.')
        safe = {'manual_type': manual_type}
        for key in V4_NUMBERS | ({'LT', 'ST', 'enterotoxin'} if 'pack_fingerprint' in data else set()):
            v = obs.get(key)
            if type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 100000:
                raise ValueError('Invalid local reading.')
            safe[key] = v
        for key in ('cargo', 'contact', 'reserve', 'recruited', 'adapted'):
            if type(obs.get(key)) is not bool:
                raise ValueError('Invalid local flag.')
            safe[key] = obs[key]
        reasons = obs.get('reasons')
        if not isinstance(reasons, list) or not reasons or len(reasons) > 16 or any(not isinstance(r, str) or r not in V4_REASONS for r in reasons):
            raise ValueError('A local activation cue is required.')
        safe['reasons'] = list(reasons)
        cleaned.append({'id':c['id'], 'type':typ, 'actions':list(actions), 'observation':safe})
    return {k:data[k] for k in ('run_id','tick','revision','time_min','contract')} | {'cells':cleaned, 'call_limit':data.get('call_limit',10000)}

def build_v4_request(cells, model=None):
    def criterion(a):
        if a == 'WAIT':
            return 'Keep observing. Start no new action now; conserve resources when local evidence is insufficient.'
        rule = V4_ACTIONS[a]
        return {'label':rule['label'], 'effects':rule['completion_effects'],
                'constraints':rule['gate'], 'duration_minutes':V4_REGISTRY['duration_models'][rule['duration_ref']],
                'notes':rule['notes']}
    return {'model':model or MODEL, 'state':{
        'setting':'Individual cells in an uncalibrated intestinal tissue simulation governed by a fixed biological manual.',
        'rules':'Each question is an independent cell. Use only its local readings and the supplied eligible actions. The host checked lineage, contact, compartment, resources and manual gates. Choose a response suited to this cell, or WAIT. Do not invent distant threats. Choices initiate processes; their durations, targets and physical effects are owned by the host. Confidence is not a biological rate.'},
        'questions':{f'cell_{c["id"]}':{'type':'choice', 'instructions':{
            'task':'Choose the next permitted action for this individual cell in response to local_observation. Other cells and the user scenario are unknown.',
            'local_observation':c['observation']},
            'criteria':{a:criterion(a) for a in c['actions']}} for c in cells}}


def get_usage(body):
    usage = body.get('usage') if isinstance(body, dict) else None
    if not isinstance(usage, dict) or any(type(usage.get(k)) is not int or usage[k] < 0
                                          for k in ('input_tokens', 'output_tokens')):
        return None
    return {'input_tokens': usage['input_tokens'], 'output_tokens': usage['output_tokens']}


def validate_answer(body: Any, cells: list[dict]) -> tuple[dict, dict]:
    if (not isinstance(body, dict) or not isinstance(body.get('answers'), dict)
            or not isinstance(body.get('model'), str) or not 0 < len(body['model']) <= 100):
        raise ProviderError('Malformed Jev response.')
    answers = body['answers']
    if set(answers) != {f'cell_{c["id"]}' for c in cells}:
        raise ProviderError('Missing or unexpected cell answers. No partial round was applied.')
    result = {}
    for c in cells:
        a, actions = answers[f'cell_{c["id"]}'], c['actions']
        if not isinstance(a, dict) or a.get('type') != 'choice' or a.get('choice') not in actions:
            raise ProviderError('Action outside the legal menu.')
        weights, confidence = a.get('probabilities'), a.get('confidence')
        if not isinstance(weights, dict) or set(weights) != set(actions):
            raise ProviderError('Probability menu mismatch.')
        error_meta = {'code': 'invalid_probabilities', 'cellId': c['id']}
        def probability_error(reason):
            raise ProviderError(
                f"Invalid Jev probabilities for cell {c['id']}: {reason}. "
                "No cellular decisions or physical step were applied for this round. "
                "Save the partial recording; usage from this request is retained.", error_meta)
        if any(type(v) not in (int, float) for v in weights.values()):
            probability_error('expected JSON numbers, not strings, booleans or null')
        if any(not 0 <= v <= 1 for v in weights.values()):
            probability_error('each value must be finite and between 0 and 1')
        # Tolerate serialization rounding only; never normalize an invalid answer,
        # fill missing options, or manufacture a deterministic fallback.
        total = math.fsum(weights.values())
        if not math.isfinite(total) or abs(total - 1) > 1e-6:
            probability_error('the distribution must sum to 1 (tolerance 0.000001)')
        if type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1:
            raise ProviderError('Invalid confidence.')
        if weights[a['choice']] + 1e-6 < max(weights.values()):
            raise ProviderError('Choice conflicts with its distribution.')
        result[str(c['id'])] = {'action': a['choice'], 'weights': weights,
                               'confidence': confidence, 'source': 'Jev'}
    usage = get_usage(body)
    if usage is None:
        raise ProviderError('Invalid token usage.')
    return result, {'model': body['model'], 'usage': usage}


class Ledger:
    def __init__(self, limit=10000):
        self.limit = limit
        self.lock = threading.Lock()
        self.started = time.monotonic()
        self.calls = self.retries = self.input_tokens = self.output_tokens = self.unknown = 0
        self.models = set()

    def attempt(self, retry=False, real=False):
        with self.lock:
            if self.calls >= self.limit:
                raise ProviderError('Experiment request limit reached. Save the partial recording.')
            if real:
                with SESSION_LOCK:
                    if SESSION['calls'] >= MAX_SESSION_CALLS:
                        raise ProviderError('The server session request limit was reached. Restart the server to reset it.')
                    SESSION['calls'] += 1
            self.calls += 1
            self.retries += int(retry)

    def usage(self, body, real=False):
        usage = get_usage(body)
        with self.lock:
            if usage is None:
                self.unknown += 1
            else:
                self.input_tokens += usage['input_tokens']
                self.output_tokens += usage['output_tokens']
            if isinstance(body, dict) and isinstance(body.get('model'), str):
                self.models.add(body['model'])
        if real:
            with SESSION_LOCK:
                if usage is None:
                    SESSION['unknownUsageCalls'] += 1
                else:
                    SESSION['inputTokens'] += usage['input_tokens']
                    SESSION['outputTokens'] += usage['output_tokens']

    def meta(self):
        with self.lock:
            return {'calls': self.calls, 'retries': self.retries, 'inputTokens': self.input_tokens,
                    'outputTokens': self.output_tokens, 'unknownUsageCalls': self.unknown,
                    'elapsedMs': round((time.monotonic() - self.started) * 1000),
                    'usage': {'input_tokens': self.input_tokens, 'output_tokens': self.output_tokens},
                    'modelsReported': sorted(self.models), 'contract': CONTRACT}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward an Authorization header to a redirect target.
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def retry_delay(header: str | None, attempt: int) -> float:
    if header:
        try:
            delay = float(header)
        except ValueError:
            try:
                parsed = parsedate_to_datetime(header)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                delay = (parsed - datetime.now(timezone.utc)).total_seconds()
            except (ValueError, TypeError, OverflowError):
                delay = 0
        if math.isfinite(delay) and delay > 0:
            return delay
    return min(4.0, 0.5 * (2 ** attempt))


def call_remote(payload: dict, *, ledger: Ledger | None = None, deadline=None,
                max_attempts=None, opener=None, sleep=None) -> dict:
    ledger = ledger or Ledger()
    deadline = deadline or (time.monotonic() + ROUND_TIMEOUT)
    attempts = MAX_ATTEMPTS if max_attempts is None else max_attempts
    opener = opener or OPENER
    sleep = sleep or time.sleep
    if not KEY:
        raise ProviderError('No Jev key is configured. Set TYPESAFE_API_KEY on the server.')
    encoded = json.dumps(payload, ensure_ascii=True, allow_nan=False, separators=(',', ':')).encode('utf-8')
    for attempt in range(attempts):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ProviderError('Jev round timed out. The physical round was not applied.')
        req = urllib.request.Request(ENDPOINT, data=encoded, method='POST', headers={
            'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json',
            'Accept': 'application/json', 'User-Agent': f'Cellville/{VERSION}',
        })
        ledger.attempt(retry=attempt > 0, real=True)
        try:
            with opener.open(req, timeout=min(REQUEST_TIMEOUT, remaining)) as response:
                content = response.read(2_000_001)
            if len(content) > 2_000_000:
                raise ValueError('Oversized response')
            body = json.loads(content, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
        except urllib.error.HTTPError as exc:
            ledger.usage(None, real=True)
            code, header = exc.code, exc.headers.get('Retry-After') if exc.headers else None
            exc.close()
            delay = retry_delay(header, attempt)
            retryable = code in (429, 529, 502, 503, 504)
            if retryable and attempt + 1 < attempts and delay <= 4 and time.monotonic() + delay < deadline:
                sleep(delay)
                continue
            explanations = {
                401: 'Jev rejected the API key. Verify TYPESAFE_API_KEY on the server.',
                403: 'Jev denied access. Check the API key permissions or account access.',
                402: 'Jev returned a billing or credit error. Check the TypeSafe account.',
                422: 'Jev rejected the request schema or model. Check the current TypeSafe contract.',
                429: 'Jev rate limit reached. Wait before starting another cycle.',
                529: 'Jev is temporarily overloaded. Try another cycle later.',
            }
            raise ProviderError(explanations.get(code, f'Jev returned HTTP {code}.'),
                                {'upstreamStatus': code, 'retryAfterSeconds': round(delay, 2) if retryable else None}) from None
        except (OSError, ValueError, urllib.error.URLError):
            ledger.usage(None, real=True)
            # No automatic retry on ambiguous transport failures: the request may
            # already have been evaluated and charged upstream.
            raise ProviderError('Jev connection failed or returned invalid JSON. Usage for this attempt is unknown.') from None
        ledger.usage(body, real=True)
        return body
    raise ProviderError('Jev retries exhausted.')


def groups_for(cells, builder=build_request):
    groups, current = [], []
    for cell in cells:
        candidate = current + [cell]
        byte_count = len(json.dumps(builder(candidate), separators=(',', ':')).encode('utf-8'))
        if current and (len(candidate) > BATCH_SIZE or byte_count > MAX_REQUEST_BYTES):
            groups.append(current)
            current = [cell]
        else:
            current = candidate
        if len(json.dumps(builder(current)).encode()) > MAX_REQUEST_BYTES:
            raise ValueError('A cell observation exceeds the application request budget.')
    if current:
        groups.append(current)
    return groups


def process_round(data: dict, transport: Callable[[dict], dict] | None = None, *, max_attempts=None, unified=False) -> dict:
    data = validate_v4_payload(data) if unified else validate_payload(data)
    builder = build_v4_request if unified else build_request
    groups = groups_for(data['cells'], builder)
    ledger = Ledger(data.get('call_limit', 10000))
    if len(groups) > ledger.limit:
        raise ProviderError('Insufficient remaining requests for a complete cellular round. Save the partial recording.', ledger.meta())
    deadline = time.monotonic() + ROUND_TIMEOUT
    results, failure = [], None

    def call(batch):
        request = builder(batch)
        if transport is None:
            raw = call_remote(request, ledger=ledger, deadline=deadline, max_attempts=max_attempts)
        else:
            ledger.attempt()
            try:
                raw = transport(request)
            except Exception:
                ledger.usage(None)
                raise
            ledger.usage(raw)
        decisions, metadata = validate_answer(raw, batch)
        if time.monotonic() > deadline:
            raise ProviderError('Round deadline exceeded.')
        return decisions, metadata

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(call, group) for group in groups]
        for future in as_completed(futures):
            if future.cancelled():
                continue
            try:
                results.append(future.result())
            except Exception as exc:
                if failure is None:
                    failure = exc if isinstance(exc, ProviderError) else ProviderError('A decision batch failed.')
                for pending in futures:
                    pending.cancel()
    meta = ledger.meta()
    meta['batches'] = len(groups)
    meta['cellQuestions'] = len(data['cells'])
    if failure:
        meta.update({k: v for k, v in failure.meta.items() if k in ('upstreamStatus', 'retryAfterSeconds', 'code', 'cellId')})
        raise ProviderError(str(failure), meta)
    decisions, models = {}, set()
    for result, metadata in results:
        decisions.update(result)
        models.add(metadata['model'])
    if len(models) > 1:
        raise ProviderError('Model changed across batches. Pin JEV_MODEL to one version.', meta)
    meta['model'] = next(iter(models), MODEL)
    return {'tick': data['tick'], 'revision': data['revision'], 'decisions': decisions, 'meta': meta, **({k:data[k] for k in ('run_id','time_min','contract')} if unified else {})}


def connection_check(transport=None):
    """One synthetic Choice question; never changes any browser tissue state.

    Uses exactly one attempt, even for retryable HTTP errors. Triggered only by
    the user's Test Jev connection button or explicit --check-jev command.
    """
    synthetic = {'tick': 0, 'revision': 0, 'cells': [{
        'id': 0, 'type': 'enterocyte', 'actions': ['maintain', 'reinforce'],
        'observation': {'type': 'enterocyte', 'health': 'healthy', 'energy': 'high',
                        'pathogen': 'absent', 'danger': 'absent', 'chemokine': 'absent',
                        'cytokine': 'absent', 'junctionDamage': 'absent', 'neighbors': [],
                        'reserve': False, 'nearbyGap': False},
    }]}
    result = process_round(synthetic, transport, max_attempts=1)
    return {'ok': True, 'kind': 'synthetic_connection_check', 'tissueChanged': False,
            'decision': result['decisions']['0'], 'meta': result['meta']}


def status_payload():
    with SESSION_LOCK:
        session = dict(SESSION)
    return {'configured': bool(KEY), 'model': MODEL, 'version': VERSION, 'contract': CONTRACT,
            'batchSize': BATCH_SIZE, 'maxAttempts': MAX_ATTEMPTS, 'session': session,
            'maxSessionCalls': MAX_SESSION_CALLS, 'keyLocation': 'server only', 'packId': ACTIVE_PACK['definition']['id'], 'packFingerprint': ACTIVE_PACK['fingerprint']}


class Handler(BaseHTTPRequestHandler):
    server_version = 'CellvilleLocal/3.1'

    def log_message(self, fmt, *args):
        # Only route, status and caller address. Never log POST bodies or headers.
        print(f'{self.address_string()} {fmt % args}')

    def host_ok(self):
        return self.headers.get('Host', '') in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}

    def json_response(self, status, data):
        body = json.dumps(data, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Client cancellation does not mean the provider did not bill.

    def do_GET(self):
        if not self.host_ok():
            return self.json_response(403, {'error': 'Unexpected host.'})
        if self.path == '/api/status':
            return self.json_response(200, status_payload())
        if self.path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
            return
        public = {'/':'Cellville_3D.html', '/Cellville_3D.html':'Cellville_3D.html', '/player.html':'player.html', '/manual.html':'docs/manual.html'}
        route = self.path.split('?')[0]
        if route not in public:
            return self.json_response(404, {'error': 'Not found.'})
        body = (ROOT / public[route]).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path not in ('/api/decide', '/api/v5/decide', '/api/cells/decide', '/api/check'):
            return self.json_response(404, {'error': 'Not found.'})
        allowed = {f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'}
        if not self.host_ok() or self.headers.get('Origin') not in allowed:
            return self.json_response(403, {'error': 'Only the local application may call this endpoint.'})
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            return self.json_response(415, {'error': 'JSON is required.'})
        if not KEY:
            return self.json_response(503, {'error': 'No Jev key is configured. Set TYPESAFE_API_KEY in the server environment, local .env, or hidden terminal prompt.', 'meta': {'calls': 0, 'inputTokens': 0}})
        if not ROUND_LOCK.acquire(blocking=False):
            return self.json_response(409, {'error': 'Another request is already running. No new call was made.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length < 2_000_000:
                raise ValueError('Invalid payload size.')
            self.connection.settimeout(10)
            data = json.loads(self.rfile.read(length), parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
            if self.path == '/api/check':
                if data != {}:
                    raise ValueError('The connection check accepts an empty object only.')
                result = connection_check()
            else:
                if self.path == '/api/cells/decide' and data.get('pack_fingerprint') != ACTIVE_PACK['fingerprint']:
                    raise ValueError('Tissue pack mismatch. Rebuild and restart the local server.')
                result = process_round(data, unified=self.path in ('/api/v5/decide', '/api/cells/decide'))
            self.json_response(200, result)
        except (ValueError, TypeError, KeyError) as exc:
            self.json_response(400, {'error': str(exc)})
        except ProviderError as exc:
            self.json_response(502, {'error': str(exc), 'meta': exc.meta})
        except Exception:
            self.json_response(500, {'error': 'The request failed. No round was returned.'})
        finally:
            ROUND_LOCK.release()


def main():
    global KEY
    parser = argparse.ArgumentParser(description='Serve Cellville locally with manual-constrained TypeSafe/Jev cell decisions.')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--no-prompt', action='store_true')
    parser.add_argument('--check-jev', action='store_true', help='Make one small paid synthetic connection test, print safe metadata, then exit.')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('Port must be from 0 to 65535.')
    if not KEY and not args.no_prompt and sys.stdin.isatty():
        try:
            KEY = getpass.getpass('TypeSafe API key (hidden), or Enter to inspect without cellular decisions: ').strip()
        except (EOFError, KeyboardInterrupt):
            KEY = ''
    if any(ord(c) < 32 for c in KEY):
        parser.error('Invalid API credential format.')
    if args.check_jev:
        try:
            result = connection_check()
            print(json.dumps(result, indent=2))
        except ProviderError as exc:
            print(json.dumps({'ok': False, 'error': str(exc), 'meta': exc.meta}, indent=2))
            return 1
        return 0
    http = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    address = f'http://127.0.0.1:{http.server_port}'
    print(f'Cellville 3D {VERSION}: {address}')
    print('TypeSafe key configured. No API request is made until you explicitly test or use Jev.' if KEY else 'Jev not configured. Tissue inspection is available; cellular decisions require a key.')
    print('Keep this server local. Press Ctrl+C to stop.')
    if not args.no_browser:
        webbrowser.open(address)
    try:
        http.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        http.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
