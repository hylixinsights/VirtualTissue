import sys, unittest, copy, threading
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import server
from test_v4_server import payload,response
class ExperimentProtocol(unittest.TestCase):
 def pack_payload(self):
  p=payload();p['pack_fingerprint']=server.ACTIVE_PACK['fingerprint'];p['cells'][0]['observation'].update(LT=.1,ST=.2,enterotoxin=.9);return p
 def test_mismatch_rejected_before_any_transport(self):
  p=self.pack_payload();p['pack_fingerprint']='wrong'
  with self.assertRaises(ValueError):server.process_round(p,lambda r:self.fail('transport called'),unified=True)
 def test_explicit_population_identity_cannot_be_forged(self):
  p=self.pack_payload();p['cells'][0]['id']=70
  with self.assertRaises(ValueError):server.validate_v4_payload(p)
 def test_etec_menu_carries_real_extension_and_local_toxins(self):
  p=self.pack_payload();p['cells'][0]['actions']=['WAIT','EPITHELIAL_ION_SECRETION'];p['cells'][0]['observation']['reasons']=['Local enterotoxin']
  seen=[]
  def upstream(r):seen.append(r);return response(r)
  r=server.process_round(p,upstream,unified=True);self.assertEqual(r['decisions']['0']['action'],'EPITHELIAL_ION_SECRETION');self.assertEqual(seen[0]['questions']['cell_0']['instructions']['local_observation']['LT'],.1)
 def test_zero_budget_makes_no_calls(self):
  p=self.pack_payload();p['call_limit']=0
  try:server.process_round(p,lambda r:self.fail('transport called'),unified=True);self.fail('accepted')
  except server.ProviderError as e:self.assertEqual(e.meta['calls'],0)
 def test_budget_preflight_rejects_incomplete_round(self):
  p=payload();p['call_limit']=1;p['cells']=[{**copy.deepcopy(p['cells'][0]),'id':i} for i in range(25)]
  with self.assertRaises(server.ProviderError):server.process_round(p,lambda r:self.fail('transport called'),unified=True)
 def test_concurrent_attempts_cannot_exceed_budget(self):
  ledger=server.Ledger(3);errors=[]
  def attempt():
   try:ledger.attempt()
   except server.ProviderError:errors.append(1)
  ts=[threading.Thread(target=attempt) for _ in range(12)]
  for t in ts:t.start()
  for t in ts:t.join()
  self.assertEqual(ledger.calls,3);self.assertEqual(len(errors),9)
if __name__=='__main__':unittest.main(verbosity=2)
