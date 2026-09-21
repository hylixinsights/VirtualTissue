/** Deterministic offline reference experiment. Does not contact a provider. */
import {ManualTissue} from '../src/manual-host.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs';

const tissue=new ManualTissue(20260919);
tissue.inject('combined',.25);
for(let i=0;i<10;i++)tissue.step(60);
const events=[...tissue.kernel.events.values()];
const physics={cells:tissue.cells,fields:Object.fromEntries(Object.entries(tissue.fields.values).map(([k,v])=>[k,Array.from(v)])),events};
const result={experiment:'paired_stimulus_600_min',seed:tissue.seed,time_min:tissue.time_min,
  rule_sha256:tissue.manifest.rule_hash,host_manifest_version:tissue.manifest.version,
  accepted:Object.fromEntries(['EPITHELIAL_CXCL8_INDUCTION','GOBLET_RELEASE'].map(id=>[id,events.filter(e=>e.action_id===id&&e.status==='acknowledged').length])),
  fields:tissue.fields.audit(),counts:tissue.metrics,api_calls:0,
  physics_sha256:createHash('sha256').update(JSON.stringify(physics)).digest('hex'),
  note:'Run IDs differ by design. Physics hash excludes run identity. Floating-point details may differ across JS engines; compare counts and mass residuals with tolerance.'};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
