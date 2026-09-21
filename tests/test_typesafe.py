"""New TypeSafe contract, connection, retry and secret-boundary regression tests.
All provider responses are synthetic. No real TypeSafe requests are made.
"""
import copy
import io
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from test_server import payload, reply


class FakeResponse:
    def __init__(self, body):
        self.body = body
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass
    def read(self, size=-1):
        raw = self.body if isinstance(self.body, bytes) else json.dumps(self.body).encode()
        return raw if size < 0 else raw[:size]


class SequenceOpener:
    def __init__(self, sequence):
        self.sequence = list(sequence)
        self.requests = []
    def open(self, request, timeout):
        self.requests.append(request)
        item = self.sequence.pop(0)
        if isinstance(item, Exception):
            raise item
        if callable(item):
            item = item(json.loads(request.data))
        return FakeResponse(item)


def http_error(code, retry_after=None):
    headers = {'Retry-After': retry_after} if retry_after else {}
    return urllib.error.HTTPError(server.ENDPOINT, code, 'test status', headers, io.BytesIO(b''))


class Configuration(unittest.TestCase):
    def test_env_file_is_optional(self):
        env = {}
        server.load_local_env(Path('/not/a/real/env'), env)
        self.assertEqual(env, {})

    def parse_env(self, text, initial=None):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / '.env'
            p.write_text(text)
            env = {} if initial is None else initial.copy()
            server.load_local_env(p, env)
            return env

    def test_environment_wins_over_local_env(self):
        result = self.parse_env('TYPESAFE_API_KEY=file-value\nJEV_MODEL="jev-1.13.0"', {'TYPESAFE_API_KEY': 'environment-value'})
        self.assertEqual(result, {'TYPESAFE_API_KEY': 'environment-value', 'JEV_MODEL': 'jev-1.13.0'})

    def test_blank_key_does_not_configure_credential(self):
        self.assertEqual(self.parse_env('# private settings\nTYPESAFE_API_KEY=\n'), {})

    def test_unknown_env_setting_rejected(self):
        with self.assertRaises(ValueError):
            self.parse_env('UNRELATED_SERVICE_KEY=anything')

    def test_malformed_quotes_rejected_without_echoing_secret(self):
        with self.assertRaises(ValueError) as cm:
            self.parse_env('TYPESAFE_API_KEY="private-test-value')
        self.assertNotIn('private-test-value', str(cm.exception))

    def test_shell_expressions_are_never_executed(self):
        value = '$(echo should_not_execute)'
        self.assertEqual(self.parse_env('TYPESAFE_API_KEY='+value)['TYPESAFE_API_KEY'], value)


class Validation(unittest.TestCase):
    def test_boolean_tick_rejected(self):
        p = payload();p['tick'] = True
        with self.assertRaises(ValueError):server.validate_payload(p)

    def test_mismatched_cell_type_rejected(self):
        p = payload();p['cells'][0]['observation']['type'] = 'nk'
        with self.assertRaises(ValueError):server.validate_payload(p)

    def test_numeric_health_not_forwarded_as_qualitative_state(self):
        p = payload();p['cells'][0]['observation']['health'] = 100
        with self.assertRaises(ValueError):server.validate_payload(p)

    def test_arbitrary_text_is_removed_not_sent_to_cells(self):
        p = payload();p['cells'][0]['observation']['eventPrompt'] = 'Global disease prompt'
        self.assertNotIn('Global disease', json.dumps(server.build_request(server.validate_payload(p)['cells'])))

    def test_neighborhood_cannot_contain_whole_tissue(self):
        p = payload();p['cells'][0]['observation']['neighbors'] = [{'type': 'goblet'}] * 4
        with self.assertRaises(ValueError):server.validate_payload(p)

    def test_neighbor_damage_is_unambiguous(self):
        p = payload();p['cells'][0]['observation']['neighbors'] = [{'type': 'goblet', 'health': 'high', 'status': 'marked stress'}]
        neighbor = server.validate_payload(p)['cells'][0]['observation']['neighbors'][0]
        self.assertEqual(neighbor['damage'], 'high');self.assertNotIn('health', neighbor)

    def test_local_junction_damage_is_unambiguous(self):
        p = payload();p['cells'][0]['observation']['junction'] = 'high'
        obs = server.validate_payload(p)['cells'][0]['observation']
        self.assertEqual(obs['junctionDamage'], 'high');self.assertNotIn('junction', obs)

    def test_json_boolean_not_text_boolean(self):
        p = payload();p['cells'][0]['observation']['reserve'] = 'false'
        with self.assertRaises(ValueError):server.validate_payload(p)

    def test_empty_model_rejected(self):
        p = payload();raw = reply(server.build_request(p['cells']), model='')
        with self.assertRaises(server.ProviderError):server.validate_answer(raw, p['cells'])

    def test_invalid_probabilities_do_not_erase_reported_token_usage(self):
        def bad(req):
            body = reply(req);body['answers']['cell_0']['probabilities']['alarm'] = .9
            return body
        with self.assertRaises(server.ProviderError) as cm:server.process_round(payload(), bad)
        self.assertEqual(cm.exception.meta['inputTokens'], 321)
        self.assertEqual(cm.exception.meta['calls'], 1)

    def test_byte_budget_splits_request(self):
        cells = server.validate_payload(payload(20))['cells']
        single_size = len(json.dumps(server.build_request(cells[:1])).encode())
        with patch.object(server, 'MAX_REQUEST_BYTES', single_size + 100), patch.object(server, 'BATCH_SIZE', 100):
            self.assertGreater(len(server.groups_for(cells)), 1)

    def test_independent_questions_contain_only_their_cell_observation(self):
        p = payload();p['cells'][1]['observation']['health'] = 'critical'
        req = server.build_request(p['cells'])
        self.assertNotIn('critical', json.dumps(req['state']))
        self.assertNotIn('critical', json.dumps(req['questions']['cell_0']))
        self.assertIn('critical', json.dumps(req['questions']['cell_1']))


class Transport(unittest.TestCase):
    def setUp(self):
        self.key_patch = patch.object(server, 'KEY', 'test-only-not-a-real-key')
        self.key_patch.start()
        self.session_patch = patch.dict(server.SESSION, {'calls': 0, 'inputTokens': 0, 'outputTokens': 0, 'unknownUsageCalls': 0})
        self.session_patch.start()
    def tearDown(self):
        self.session_patch.stop();self.key_patch.stop()

    def test_http_uses_exact_endpoint_and_server_credential(self):
        opener = SequenceOpener([reply]);ledger = server.Ledger()
        server.call_remote(server.build_request(payload()['cells']), opener=opener, ledger=ledger)
        request = opener.requests[0]
        self.assertEqual(request.full_url, server.ENDPOINT)
        self.assertEqual(request.get_header('Authorization'), 'Bearer test-only-not-a-real-key')
        self.assertNotIn('test-only', request.data.decode())
        self.assertEqual(ledger.meta()['inputTokens'], 321)

    def test_429_retries_with_delay_and_records_attempts(self):
        opener = SequenceOpener([http_error(429, '1'), reply]);waits=[];ledger=server.Ledger()
        server.call_remote(server.build_request(payload()['cells']), opener=opener, ledger=ledger, sleep=waits.append)
        self.assertEqual(waits, [1]);self.assertEqual(ledger.meta()['calls'], 2)
        self.assertEqual(ledger.meta()['retries'], 1);self.assertEqual(ledger.meta()['unknownUsageCalls'], 1)

    def test_529_retries_with_bounded_backoff(self):
        opener=SequenceOpener([http_error(529), reply]);waits=[]
        server.call_remote(server.build_request(payload()['cells']), opener=opener, sleep=waits.append)
        self.assertEqual(waits, [.5])

    def test_401_does_not_retry_or_echo_key(self):
        opener=SequenceOpener([http_error(401), reply]);ledger=server.Ledger()
        with self.assertRaises(server.ProviderError) as cm:
            server.call_remote(server.build_request(payload()['cells']), opener=opener, ledger=ledger)
        self.assertEqual(ledger.meta()['calls'], 1);self.assertNotIn('test-only-not', str(cm.exception))
        self.assertEqual(cm.exception.meta['upstreamStatus'], 401)

    def test_long_retry_after_does_not_retry_earlier_than_requested(self):
        opener=SequenceOpener([http_error(429, '60'), reply]);waits=[]
        with self.assertRaises(server.ProviderError):
            server.call_remote(server.build_request(payload()['cells']), opener=opener, sleep=waits.append)
        self.assertEqual(len(opener.requests), 1);self.assertEqual(waits, [])

    def test_retry_count_is_bounded(self):
        opener=SequenceOpener([http_error(529)]*4);ledger=server.Ledger()
        with self.assertRaises(server.ProviderError):
            server.call_remote(server.build_request(payload()['cells']), opener=opener, ledger=ledger, sleep=lambda _: None)
        self.assertEqual(ledger.meta()['calls'], 3)

    def test_ambiguous_transport_failure_is_not_retried(self):
        opener=SequenceOpener([urllib.error.URLError('timeout'), reply]);ledger=server.Ledger()
        with self.assertRaises(server.ProviderError):
            server.call_remote(server.build_request(payload()['cells']), opener=opener, ledger=ledger)
        self.assertEqual(ledger.meta()['calls'], 1);self.assertEqual(ledger.meta()['unknownUsageCalls'], 1)

    def test_non_json_response_is_explicit_failure(self):
        opener=SequenceOpener([b'<html>Bad gateway</html>']);ledger=server.Ledger()
        with self.assertRaises(server.ProviderError):
            server.call_remote(server.build_request(payload()['cells']), opener=opener, ledger=ledger)
        self.assertEqual(ledger.meta()['unknownUsageCalls'], 1)

    def test_redirect_cannot_forward_authorization(self):
        self.assertIsNone(server.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.example'))

    def test_session_request_cap(self):
        opener=SequenceOpener([reply, reply])
        with patch.object(server, 'MAX_SESSION_CALLS', 1):
            server.call_remote(server.build_request(payload()['cells']), opener=opener)
            with self.assertRaises(server.ProviderError):
                server.call_remote(server.build_request(payload()['cells']), opener=opener)
        self.assertEqual(len(opener.requests), 1)

    def test_synthetic_check_does_not_retry_or_change_tissue(self):
        opener=SequenceOpener([http_error(429), reply])
        with patch.object(server, 'OPENER', opener):
            with self.assertRaises(server.ProviderError) as cm:server.connection_check()
        self.assertEqual(cm.exception.meta['calls'], 1)

    def test_connection_check_returns_distribution_and_metadata(self):
        r=server.connection_check(reply)
        self.assertTrue(r['ok']);self.assertFalse(r['tissueChanged'])
        self.assertEqual(r['meta']['cellQuestions'], 1);self.assertIn('elapsedMs', r['meta'])
        self.assertEqual(r['decision']['action'], 'maintain')
        self.assertEqual(r['decision']['weights'], {'maintain': 1, 'reinforce': 0})

    def test_session_status_does_not_contain_the_key(self):
        s=server.status_payload()
        self.assertTrue(s['configured']);self.assertNotIn(server.KEY, json.dumps(s))
        self.assertEqual(s['model'], server.MODEL)


class ConnectionHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
        cls.base=f'http://127.0.0.1:{cls.http.server_port}'
    @classmethod
    def tearDownClass(cls):cls.http.shutdown();cls.http.server_close()
    def post(self, path='/api/check', body=None, origin=None):
        req=urllib.request.Request(self.base+path,data=json.dumps(body or {}).encode(),headers={'Content-Type':'application/json','Origin':origin or self.base})
        return urllib.request.urlopen(req, timeout=5)

    def test_missing_key_check_reports_failure_without_external_request(self):
        with patch.object(server, 'KEY', ''):
            with self.assertRaises(urllib.error.HTTPError) as cm:self.post()
        self.assertEqual(cm.exception.code,503)

    def test_test_endpoint_has_same_origin_boundary(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:self.post(origin='https://foreign.example')
        self.assertEqual(cm.exception.code,403)

    def test_complete_http_connection_check(self):
        with patch.object(server,'KEY','test-only'), patch.object(server,'OPENER',SequenceOpener([reply])):
            with self.post() as r:body=json.load(r)
        self.assertTrue(body['ok']);self.assertFalse(body['tissueChanged'])
        self.assertEqual(body['meta']['calls'],1)

    def test_duplicate_simultaneous_request_rejected(self):
        with patch.object(server,'KEY','test-only'):
            server.ROUND_LOCK.acquire()
            try:
                with self.assertRaises(urllib.error.HTTPError) as cm:self.post()
            finally:server.ROUND_LOCK.release()
        self.assertEqual(cm.exception.code,409)

    def test_secret_file_never_served(self):
        for path in ['/.env','/AGENTS.md','/docs/verification.json','/server.py']:
            with self.assertRaises(urllib.error.HTTPError) as cm:urllib.request.urlopen(self.base+path)
            self.assertEqual(cm.exception.code,404)


if __name__ == '__main__':unittest.main(verbosity=2)
