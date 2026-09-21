#!/usr/bin/env python3
"""Resolve and validate a self-contained tissue pack; never load credentials."""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1]
MORPHOLOGIES = {'enterocyte','goblet','fibroblast','macrophage','neutrophil','nk'}
KINDS = {'etec','epec','ileitis','injury','regulation','resolve'}

def read(path):
    path = path.resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('Pack resources must be inside this repository.')
    return json.loads(path.read_text())

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',',':')).encode()).hexdigest()

def finite_tree(value):
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('Nonfinite pack value.')
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {'__proto__','constructor','prototype'}:
                raise ValueError('Unsafe pack key.')
            finite_tree(item)
    elif isinstance(value, list):
        for item in value: finite_tree(item)

def compile_pack(path=None, output=None):
    path = Path(path) if path else ROOT/'tissues'/read(ROOT/'tissues/active.json')['pack']
    if not path.is_absolute(): path = ROOT/path
    definition = read(path)
    finite_tree(definition)
    if definition.get('format') != 'virtualtissue.pack.v1': raise ValueError('Unknown pack format.')
    if definition.get('host_adapter') != 'ileum-cutaway-v1' or definition.get('renderer_adapter') != 'ileum-cutaway-v1':
        raise ValueError('Register a host/renderer adapter in code before selecting it in a pack.')
    base = path.parent
    registry = read(base/definition['registry'])
    manual = read(base/definition['manual_source'])
    document = (base/definition['manual_document']).resolve()
    if not document.is_relative_to(ROOT) or not document.is_file():
        raise ValueError('Manual document must exist inside the repository.')
    if manual.get('registry_sha256') != hashlib.sha256((base/definition['registry']).read_bytes()).hexdigest():
        raise ValueError('Manual registry hash mismatch: update the reviewed manual manifest.')
    if manual.get('version') != registry['metadata']['version']:
        raise ValueError('Manual and registry versions differ.')
    supported = manual.get('supported_actions', [])
    population = read(base/definition['population'])
    scenarios = read(base/definition['scenarios'])
    extensions = read(base/definition['extensions']) if definition.get('extensions') else {}
    finite_tree([registry,population,scenarios,extensions])
    original_ids = {a['id'] for a in registry['actions']}
    for action in extensions.get('actions',[]):
        if action['id'] in original_ids: raise ValueError('An extension cannot silently replace an original action.')
        original_ids.add(action['id'])
        registry['actions'].append(action)
        for name in action['cell_types']:
            registry['cell_types'][name]['allowed_actions'].append(action['id'])
    for name, model in extensions.get('duration_models',{}).items():
        if name in registry['duration_models']: raise ValueError('Duplicate duration model.')
        registry['duration_models'][name] = model
    if not supported or len(set(supported)) != len(supported) or not set(supported) <= {a['id'] for a in registry['actions']}:
        raise ValueError('Manual must declare unique supported registry actions.')
    if not isinstance(population,list) or not 2 <= len(population) <= 500: raise ValueError('Use 2–500 explicit cells.')
    ids = set()
    for cell in population:
        if not isinstance(cell.get('id'),str) or cell['id'] in ids: raise ValueError('Unique cell IDs are required.')
        ids.add(cell['id'])
        if cell['morphology'] not in MORPHOLOGIES or cell['manual_type'] not in registry['cell_types']: raise ValueError('Unknown morphology or manual identity.')
        if not all(type(cell.get(k)) in (float,int) and 0 <= cell[k] <= 1 for k in ['x','y']): raise ValueError('Cell coordinates must be in [0,1].')
        if type(cell.get('reserve')) is not bool: raise ValueError('Reserve must be explicit.')
        if type(cell.get('health')) not in (int,float) or not 0 <= cell['health'] <= 100: raise ValueError('Health out of range.')
        if type(cell.get('z')) not in (int,float) or not 0<=cell['z']<=1: raise ValueError('Invalid visual depth.')
        for key in ['resources','stores','outputs','competence','memory','programs','substrate']:
            if not isinstance(cell.get(key),dict): raise ValueError('Missing explicit cell state: '+key)
            for value in cell[key].values():
                if type(value) not in (int,float,bool) or value<0: raise ValueError('Invalid cell inventory or competence.')
        if cell['morphology'] in {'enterocyte','goblet'} and cell['reserve']: raise ValueError('This adapter does not support vascular epithelial cells.')
    if sum(c['morphology'] in {'enterocyte','goblet'} for c in population)<2: raise ValueError('Ileum adapter requires at least two epithelial boundary cells.')
    scenario_ids=set()
    for scenario in scenarios:
        if scenario['id'] in scenario_ids: raise ValueError('Duplicate scenario ID.')
        scenario_ids.add(scenario['id'])
        if type(scenario['duration_min']) is not int or not 1 <= scenario['duration_min'] <= 10080: raise ValueError('Scenario duration out of range.')
        for item in scenario['inputs']:
            if item['kind'] not in KINDS or not .055 <= item['x'] <= .945: raise ValueError('Unsupported perturbation or position.')
    for key,value in definition.get('host_parameters',{}).items():
        if key not in {'decision_interval_min','contact_radius','neighbor_radius','patch_radius','local_field_threshold','PAMP_leak_rate','DAMP_release_rate','cue_receptor_K','memory_tau_min','CCL2_output_rate','dendritic_sampling_depth'} or type(value) not in (int,float) or value<=0:
            raise ValueError('Unsupported host parameter override.')
    injury=definition.get('injury',{})
    for key in ['radius','core_radius','peak_cell_damage','minimum_barrier_damage','DAMP_per_damage']:
        value=injury.get(key)
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=1:
            raise ValueError('Invalid injury parameter: '+key)
    if not 0<=injury['core_radius']<injury['radius']<=.5 or not 0<injury['peak_cell_damage']<1:
        raise ValueError('Invalid injury radius or severity.')
    for key in ['bacteria_per_input','colonization_contact_min','LT_per_bacterium_min','ST_per_bacterium_min','receptor_K','water_per_cell_min']:
        if type(definition['etec'].get(key)) not in (int,float) or definition['etec'][key]<0: raise ValueError('Invalid ETEC parameter: '+key)
    if definition['etec']['receptor_K']<=0: raise ValueError('ETEC receptor_K must be positive.')
    if type(definition['etec']['bacteria_per_input']) is not int or not 1<=definition['etec']['bacteria_per_input']<=256: raise ValueError('ETEC input count must be 1–256.')
    record=definition['recording']
    if type(record['frame_interval_min']) is not int or not 1<=record['frame_interval_min']<=60: raise ValueError('Invalid frame interval.')
    if type(record['max_bytes']) is not int or not 1_000_000<=record['max_bytes']<=268435456: raise ValueError('Invalid recording limit.')
    result={'format':'virtualtissue.compiled-pack.v1','definition':definition,'registry':registry,'population':population,'scenarios':scenarios,
            'manual':manual,'manual_document_sha256':hashlib.sha256(document.read_bytes()).hexdigest(),'source_pack':path.relative_to(ROOT).as_posix(),'rules_sha256':digest(registry),'population_sha256':digest(population)}
    result['fingerprint']=digest(result)
    destination=Path(output) if output else ROOT/'tissues/compiled-pack.json'
    destination.write_text(json.dumps(result,indent=2,ensure_ascii=True)+'\n')
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--pack');args=parser.parse_args()
    result=compile_pack(args.pack);print(f"Compiled {result['definition']['id']}: {len(result['population'])} cells, {len(result['registry']['actions'])} rules; {result['fingerprint'][:12]}")
