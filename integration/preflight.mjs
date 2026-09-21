/** Read-only integration audit. Does not start the town or call a provider. */
import fs from 'node:fs';
import {Tissue,TYPES,ACTIONS,VERSION} from '../src/engine.mjs';
import {validateRegistry,RuleKernel} from '../manual_v2/virtual_tissue_kernel.mjs';
import {manualCoverage} from '../src/manual-host.mjs';
const registry=JSON.parse(fs.readFileSync(new URL('../manual_v2/virtual_tissue_rules_v2.json',import.meta.url)));
const fixture=JSON.parse(fs.readFileSync(new URL('../manual_v2/example_snapshot.json',import.meta.url)));
const tissue=new Tissue();
const before=JSON.stringify(tissue.export());
const result={
 status:'legacy_compatibility_and_manual_coverage_audit', runtime_manual_enabled:'opt_in', app_version:VERSION,
 manual_host_coverage:manualCoverage(),
 registry:validateRegistry(registry),
 duration_models:Object.keys(registry.duration_models).length,
 fields:Object.keys(registry.fields).length, declared_features:Object.keys(registry.features).length,
 physical_intents:registry.physical_effects.length,
 current_roster:Object.fromEntries(Object.keys(TYPES).map(t=>[t,tissue.cells.filter(c=>c.type===t).length])),
 current_reserve:tissue.cells.filter(c=>c.reserve).length,
 current_fields:Object.keys(tissue.fields), current_action_ids:Object.keys(ACTIONS),
 manual_preset_totals:Object.fromEntries(Object.entries(registry.initial_presets).map(([k,v])=>[k,Object.values(v).reduce((a,b)=>a+b,0)])),
 automatic_type_aliases:{},
 unrecognized_current_types:Object.keys(TYPES).filter(k=>!Object.hasOwn(registry.cell_types,k)),
 no_host_permissions_declared_by_this_audit:true,
 narrow_reference_fixture:new RuleKernel(registry,{seed:21,capabilities:[...registry.host_contract.required_for_any_execution,'field_transport']}).candidates(fixture),
 world_unchanged:JSON.stringify(tissue.export())===before,
 real_provider_requests:0
};
fs.writeFileSync(new URL('../docs/manual_integration/preflight.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
