"""Release contract regressions. Synthetic responses only; no provider network."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from jsonschema import Draft202012Validator
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(Path(__file__).resolve().parent))
import server
from scripts.compile_pack import compile_pack
from test_v4_server import payload,response

class ChoiceContract(unittest.TestCase):
    def test_valid_distributions_are_preserved_exactly(self):
        p=payload();cells=p['cells'];body=response(server.build_v4_request(cells))
        for a in body['answers'].values():
            keys=list(a['probabilities']);a['choice']=keys[1]
            a['probabilities']={k:(.7 if k==keys[1] else .3/(len(keys)-1)) for k in keys}
        decisions,_=server.validate_answer(body,cells)
        for c in cells:self.assertEqual(decisions[str(c['id'])]['weights'],body['answers'][f'cell_{c["id"]}']['probabilities'])

    def test_all_malformed_probability_paths_retain_usage_and_fail_whole_round(self):
        mutations=[lambda w:{},lambda w:[],lambda w:dict(w,unknown=0)]
        for bad in [None,True,'0.5',float('nan'),float('inf'),-0.1,1.1,10**400]:
            mutations.append(lambda w,bad=bad:{k:bad for k in w})
        mutations += [lambda w:{k:0 for k in w},lambda w:{k:.2 for k in w}]
        for mutation in mutations:
            def upstream(req):
                body=response(req);a=next(iter(body['answers'].values()));a['probabilities']=mutation(a['probabilities']);return body
            with self.subTest(mutation=mutation),self.assertRaises(server.ProviderError) as cm:
                server.process_round(payload(),upstream,unified=True)
            self.assertEqual(cm.exception.meta['calls'],1)
            self.assertEqual(cm.exception.meta['inputTokens'],20)

    def test_nonmaximal_choice_and_invalid_confidence_rejected(self):
        for kind in ['choice','confidence']:
            p=payload();body=response(server.build_v4_request(p['cells']));a=next(iter(body['answers'].values()))
            if kind=='choice':a['choice']=next(k for k,v in a['probabilities'].items() if v==0)
            else:a['confidence']=True
            with self.assertRaises(server.ProviderError):server.validate_answer(body,p['cells'])

    def test_sum_error_is_actionable_and_does_not_contain_upstream_content(self):
        def upstream(req):
            b=response(req);a=next(iter(b['answers'].values()));a['probabilities']={k:0 for k in a['probabilities']};return b
        with self.assertRaises(server.ProviderError) as cm:server.process_round(payload(),upstream,unified=True)
        self.assertIn('sum to 1',str(cm.exception));self.assertIn('No cellular decisions',str(cm.exception))
        self.assertEqual(cm.exception.meta['code'],'invalid_probabilities')

class ManualV3(unittest.TestCase):
    def test_v3_schema_and_shared_manifest(self):
        rules=json.loads((ROOT/'manual_v3/constraints.json').read_text())
        schema=json.loads((ROOT/'manual_v3/constraints.schema.json').read_text())
        Draft202012Validator.check_schema(schema);Draft202012Validator(schema).validate(rules)
        model=json.loads((ROOT/'manual_v3/model.json').read_text())
        self.assertEqual(model['registry_sha256'],hashlib.sha256((ROOT/'manual_v3/constraints.json').read_bytes()).hexdigest())
        self.assertEqual(len(model['supported_actions']),22)
        self.assertEqual(server.ACTIVE_PACK['registry'],rules)
        self.assertEqual(server.ACTIVE_PACK['manual'],model)
        self.assertEqual([s['id'] for s in server.ACTIVE_PACK['scenarios']],['etec','epec','ibd','baseline'])
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(compile_pack(output=Path(d)/'pack.json'),server.ACTIVE_PACK)

    def test_extension_actions_are_validated_after_assembly(self):
        # Reassemble the same gut contract through the documented extension path.
        original=server.ACTIVE_PACK['registry']
        rules=copy.deepcopy(original)
        extension=json.loads((ROOT/'tissues/ileum/extensions.json').read_text())
        added={a['id'] for a in extension['actions']}
        rules['actions']=[a for a in rules['actions'] if a['id'] not in added]
        for cell in rules['cell_types'].values():
            cell['allowed_actions']=[a for a in cell['allowed_actions'] if a not in added]
        for name in extension['duration_models']:rules['duration_models'].pop(name)
        with tempfile.TemporaryDirectory(dir=ROOT/'tissues') as folder:
            base=Path(folder)
            registry=base/'rules.json';registry.write_text(json.dumps(rules))
            manual=copy.deepcopy(server.ACTIVE_PACK['manual'])
            manual['registry_sha256']=hashlib.sha256(registry.read_bytes()).hexdigest()
            (base/'model.json').write_text(json.dumps(manual))
            definition=copy.deepcopy(server.ACTIVE_PACK['definition'])
            for key in ['population','scenarios','manual_document']:
                definition[key]=str((ROOT/'tissues/ileum'/definition[key]).resolve())
            definition.update(registry='rules.json',manual_source='model.json',
                              extensions=str(ROOT/'tissues/ileum/extensions.json'))
            (base/'pack.json').write_text(json.dumps(definition))
            result=compile_pack(base/'pack.json',base/'compiled.json')
            self.assertEqual(result['registry'],original)
            manual['registry_sha256']='incorrect';(base/'model.json').write_text(json.dumps(manual))
            with self.assertRaisesRegex(ValueError,'hash mismatch'):
                compile_pack(base/'pack.json',base/'compiled.json')

    def test_unsupported_reference_action_cannot_reach_provider(self):
        p=payload();p['cells'][0]['actions']=['WAIT','EPITHELIAL_IFN_RESPONSE']
        with self.assertRaises(ValueError):server.process_round(p,lambda _:self.fail('called provider'),unified=True)

if __name__=='__main__':unittest.main(verbosity=2)
