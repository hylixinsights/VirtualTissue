import sys,json,unittest,copy,threading,urllib.request,urllib.error
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

def payload(n=2):
 return {'tick':4,'revision':7,'cells':[{'id':i,'type':'enterocyte','actions':['maintain','alarm'],'observation':{'type':'enterocyte','health':'healthy','danger':'high','neighbors':[]}} for i in range(n)]}

def reply(req,model='test-jev-version'):
 return {'model':model,'answers':{k:{'type':'choice','choice':next(iter(q['criteria'])),'probabilities':{a:1.0 if j==0 else 0.0 for j,a in enumerate(q['criteria'])},'confidence':1.0} for k,q in req['questions'].items()},'usage':{'input_tokens':321,'output_tokens':0}}

class Protocol(unittest.TestCase):
 def test_valid_payload(self):self.assertEqual(len(server.validate_payload(payload())['cells']),2)
 def test_duplicate_ids(self):
  p=payload();p['cells'][1]['id']=0
  with self.assertRaises(ValueError):server.validate_payload(p)
 def test_foreign_action(self):
  p=payload();p['cells'][0]['actions']=['maintain','attack']
  with self.assertRaises(ValueError):server.validate_payload(p)
 def test_boolean_id_rejected(self):
  p=payload();p['cells'][0]['id']=True
  with self.assertRaises(ValueError):server.validate_payload(p)
 def test_shared_state_has_no_other_cell_or_scenario(self):
  p=payload();r=server.build_request(p['cells']);self.assertNotIn('cells',r['state']);self.assertNotIn('eventPrompt',r['state']);self.assertEqual(r['questions']['cell_0']['instructions']['local_observation'],p['cells'][0]['observation'])
 def test_shape_uses_official_choice_criteria(self):
  r=server.build_request(payload()['cells']);q=r['questions']['cell_0'];self.assertEqual(q['type'],'choice');self.assertEqual(set(q['criteria']),{'maintain','alarm'});self.assertIn('model',r)
 def test_local_neighbor_stress_is_preserved_and_typed(self):
  p=payload();p['cells'][0]['observation']['nearbyStressedCell']=True
  clean=server.validate_payload(p);r=server.build_request(clean['cells'])
  self.assertTrue(r['questions']['cell_0']['instructions']['local_observation']['nearbyStressedCell'])
  self.assertNotIn('nearbyStressedCell',r['questions']['cell_1']['instructions']['local_observation'])
  p['cells'][0]['observation']['nearbyStressedCell']='yes'
  with self.assertRaises(ValueError):server.validate_payload(p)
 def test_success_preserves_probabilities_and_usage(self):
  p=payload();r=server.process_round(p,reply);self.assertEqual(r['decisions']['0']['weights'],{'maintain':1.0,'alarm':0.0});self.assertEqual(r['meta']['inputTokens'],321);self.assertEqual(r['meta']['model'],'test-jev-version')
 def test_batches_counted_separately_from_decisions(self):
  r=server.process_round(payload(45),reply);self.assertEqual(len(r['decisions']),45);self.assertEqual(r['meta']['calls'],3)
 def test_missing_answer_rejects_entire_round(self):
  def broken(req):r=reply(req);r['answers'].pop(next(iter(r['answers'])));return r
  with self.assertRaises(server.ProviderError):server.process_round(payload(),broken)
 def test_nonfinite_distribution(self):
  r=reply(server.build_request(payload()['cells']));r['answers']['cell_0']['probabilities']['maintain']=float('nan')
  with self.assertRaises(server.ProviderError):server.validate_answer(r,payload()['cells'])
 def test_choice_must_match_distribution(self):
  r=reply(server.build_request(payload()['cells']));r['answers']['cell_0']['choice']='alarm'
  with self.assertRaises(server.ProviderError):server.validate_answer(r,payload()['cells'])
 def test_failed_round_reports_attempted_calls(self):
  def fail(req):raise server.ProviderError('Simulated failure')
  with self.assertRaises(server.ProviderError) as cm:server.process_round(payload(),fail)
  self.assertEqual(cm.exception.meta['calls'],1)
 def test_mixed_model_versions_rejected(self):
  def mixed(req):return reply(req,'one' if 'cell_0' in req['questions'] else 'two')
  with self.assertRaises(server.ProviderError):server.process_round(payload(25),mixed)
 def test_empty_active_set_makes_zero_calls(self):
  r=server.process_round(payload(0),lambda req:(_ for _ in ()).throw(Exception('Unexpected call')));self.assertEqual(r['meta']['calls'],0)

class HTTP(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.previous=server.KEY;server.KEY='';cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler);cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start();cls.base=f'http://127.0.0.1:{cls.http.server_port}'
 @classmethod
 def tearDownClass(cls):cls.http.shutdown();cls.http.server_close();server.KEY=cls.previous
 def get(self,path):return urllib.request.urlopen(self.base+path)
 def test_status_never_exposes_key(self):
  with self.get('/api/status') as r:d=json.load(r)
  self.assertEqual(d['configured'],False);self.assertNotIn('key',d)
 def test_static_page_has_correct_type(self):
  with self.get('/') as r:self.assertIn('text/html',r.headers['Content-Type']);self.assertIn(b'Cellville',r.read())
 def test_source_and_secret_paths_not_served(self):
  for path in ['/server.py','/.env','/../server.py']:
   with self.assertRaises(urllib.error.HTTPError) as cm:self.get(path)
   self.assertEqual(cm.exception.code,404)
 def test_foreign_origin_rejected(self):
  req=urllib.request.Request(self.base+'/api/decide',data=b'{}',headers={'Content-Type':'application/json','Origin':'https://external.example'})
  with self.assertRaises(urllib.error.HTTPError) as cm:urllib.request.urlopen(req)
  self.assertEqual(cm.exception.code,403)
 def test_missing_key_is_explicit_not_local_fallback(self):
  req=urllib.request.Request(self.base+'/api/decide',data=json.dumps(payload()).encode(),headers={'Content-Type':'application/json','Origin':self.base})
  with self.assertRaises(urllib.error.HTTPError) as cm:urllib.request.urlopen(req)
  self.assertEqual(cm.exception.code,503);self.assertIn('No Jev key',json.load(cm.exception)['error'])
if __name__=='__main__':unittest.main(verbosity=2)
