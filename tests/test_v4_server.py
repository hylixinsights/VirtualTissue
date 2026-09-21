import sys,unittest,json,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

def payload():
 return {'run_id':'test-v4','tick':1,'revision':2,'time_min':1,'contract':server.V4_CONTRACT,'cells':[{'id':0,'type':'enterocyte','actions':['WAIT','EPITHELIAL_CXCL8_INDUCTION'],'observation':{'manual_type':'enterocyte','energy':1,'health':100,'TNF':.1,'CXCL8':0,'PAMP':.4,'DAMP':0,'nearby_pathogens':1,'nearby_altered_cells':0,'nearby_barrier_damage':0,'gradient':0,'alarm_memory':.4,'CCL2':0,'damage':0,'antigen_count':0,'presented_count':0,'recruited':False,'adapted':False,'cargo':False,'contact':True,'reserve':False,'reasons':['Nearby pathogen']}}]}
def response(request):
 return {'model':'fixture-jev','usage':{'input_tokens':20,'output_tokens':5},'answers':{k:{'type':'choice','choice':list(q['criteria'])[1],'probabilities':{a:int(i==1) for i,a in enumerate(q['criteria'])},'confidence':1} for k,q in request['questions'].items()}}
class UnifiedProtocol(unittest.TestCase):
 def test_manual_contract_and_epoch_roundtrip(self):
  r=server.process_round(payload(),response,unified=True);self.assertEqual(r['run_id'],'test-v4');self.assertEqual(r['time_min'],1);self.assertEqual(r['decisions']['0']['action'],'EPITHELIAL_CXCL8_INDUCTION');self.assertEqual(r['meta']['cellQuestions'],1)
 def test_global_prompt_and_map_do_not_cross_provider_boundary(self):
  p=payload();p['prompt']='IBD everywhere';p['cells'][0]['observation']['whole_map']=[1,2];clean=server.validate_v4_payload(p);q=server.build_v4_request(clean['cells']);self.assertNotIn('IBD everywhere',json.dumps(q));self.assertNotIn('whole_map',json.dumps(q));self.assertIn('local_observation',q['questions']['cell_0']['instructions'])
 def test_no_local_activation_is_rejected(self):
  p=payload();p['cells'][0]['observation']['reasons']=[]
  with self.assertRaises(ValueError):server.validate_v4_payload(p)
 def test_wrong_lineage_cannot_choose_myeloid_action(self):
  p=payload();p['cells'][0]['actions'][1]='MYELOID_TNF_INDUCTION'
  with self.assertRaises(ValueError):server.validate_v4_payload(p)
 def test_manual_macrophage_identity_is_explicit(self):
  p=payload();c=p['cells'][0];c['type']='macrophage';c['observation']['manual_type']='resident_macrophage';c['actions'][1]='PHAGOCYTOSIS';self.assertEqual(server.validate_v4_payload(p)['cells'][0]['observation']['manual_type'],'resident_macrophage')
 def test_duplicate_cells_rejected(self):
  p=payload();p['cells']*=2
  with self.assertRaises(ValueError):server.validate_v4_payload(p)
 def test_nonfinite_and_missing_readings_rejected(self):
  for v in [None,float('nan'),-1,'high',True]:
   p=payload();p['cells'][0]['observation']['TNF']=v
   with self.assertRaises(ValueError):server.validate_v4_payload(p)
 def test_missing_reply_is_not_a_partial_success(self):
  def bad(r):x=response(r);x['answers']={};return x
  with self.assertRaises(server.ProviderError):server.process_round(payload(),bad,unified=True)
 def test_independent_questions_batched_without_sharing_observations(self):
  p=payload();p['cells']=[{**copy.deepcopy(p['cells'][0]),'id':i} for i in range(21)];seen=[]
  def respond(r):seen.append(r);return response(r)
  r=server.process_round(p,respond,unified=True);self.assertEqual(len(r['decisions']),21);self.assertEqual(sum(len(q['questions']) for q in seen),21);self.assertNotIn('cells',seen[0]['state']);self.assertGreaterEqual(len(seen),2)
 def test_failed_calls_report_usage(self):
  def malformed(r):x=response(r);next(iter(x['answers'].values()))['probabilities']={'WAIT':1};return x
  try:server.process_round(payload(),malformed,unified=True);self.fail()
  except server.ProviderError as e:self.assertEqual(e.meta['calls'],1);self.assertEqual(e.meta['inputTokens'],20)
 def test_unknown_contract_rejected(self):
  p=payload();p['contract']='old'
  with self.assertRaises(ValueError):server.validate_v4_payload(p)
 def test_request_contains_actual_manual_constraints_and_durations(self):
  q=server.build_v4_request(payload()['cells'])['questions']['cell_0'];self.assertEqual(q['criteria']['EPITHELIAL_CXCL8_INDUCTION']['duration_minutes']['lower'],30);self.assertIn('constraints',q['criteria']['EPITHELIAL_CXCL8_INDUCTION']);self.assertEqual(q['type'],'choice')
class V5IdentityProtocol(unittest.TestCase):
 def test_dendritic_antigen_choice_is_licensed_and_explicit(self):
  p=payload();c=p['cells'][0];c['type']='macrophage';c['observation']['manual_type']='dendritic';c['observation']['antigen_count']=1;c['observation']['reasons']=['Acquired antigen'];c['actions']=['WAIT','DC_ANTIGEN_PROCESSING'];q=server.build_v4_request(server.validate_v4_payload(p)['cells']);self.assertEqual(q['questions']['cell_0']['instructions']['local_observation']['manual_type'],'dendritic');self.assertIn('DC_ANTIGEN_PROCESSING',q['questions']['cell_0']['criteria'])
 def test_monocyte_ccl2_reading_cannot_be_missing_or_replaced_with_cxcl8(self):
  p=payload();c=p['cells'][0];c['type']='macrophage';c['observation']['manual_type']='inflammatory_monocyte';c['actions']=['WAIT','MONOCYTE_CHEMOTAXIS'];self.assertEqual(server.validate_v4_payload(p)['cells'][0]['observation']['CCL2'],0);del c['observation']['CCL2']
  with self.assertRaises(ValueError):server.validate_v4_payload(p)
 def test_nk_cannot_claim_dendritic_identity(self):
  p=payload();c=p['cells'][0];c['type']='nk';c['observation']['manual_type']='dendritic';c['actions']=['WAIT','DC_ANTIGEN_PROCESSING']
  with self.assertRaises(ValueError):server.validate_v4_payload(p)
if __name__=='__main__':unittest.main(verbosity=2)
