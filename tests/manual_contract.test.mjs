import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {RuleKernel, validateRegistry, validateProviderResponse} from '../manual_v2/virtual_tissue_kernel.mjs';
import {freezeSnapshot, prepareAdvisoryBatch, validateCompleteChannelReply} from '../integration/manual_contract.mjs';
import {Tissue, TYPES} from '../src/engine.mjs';
const r = JSON.parse(fs.readFileSync(new URL('../manual_v2/virtual_tissue_rules_v2.json', import.meta.url)));
const fixture = JSON.parse(fs.readFileSync(new URL('../manual_v2/example_snapshot.json', import.meta.url)));
const epoch = { run_id: 'run_a', tick:0, revision:0, time_min:0 };
const kernel = () => new RuleKernel(r, {seed:42, capabilities:[...r.host_contract.required_for_any_execution, 'field_transport']});
const build = () => prepareAdvisoryBatch(kernel(), [fixture], epoch).batch;
const good = batch => ({run_id:batch.run_id, tick:batch.tick, revision:batch.revision,
  decisions:batch.cells.flatMap(c=>[...new Set(Object.values(c.channels))].map(channel=>({id:c.id,channel,choice:c.allowed.find(a=>c.channels[a]===channel)})))});
const reject = (batch, reply, current=epoch) => assert.throws(()=>validateCompleteChannelReply(batch,reply,current));

test('original registry hash equals attached authoritative JSON',()=>{
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../manual_v2/virtual_tissue_rules_v2.json',import.meta.url))).digest('hex'), 'db6bac825389a9d99957ddc425be355a1b50fd48571260e748f5e0b6f17078be');
});
test('registry cross reference validation and exact counts',()=>{
 assert.deepEqual(validateRegistry(r),{valid:true,actions:55,cell_types:28,parameters:55});
 assert.equal(Object.keys(r.fields).length,15);assert.equal(Object.keys(r.features).length,125);
});
test('both manual rosters start at 100 and population is not fixed',()=>{
 for(const p of Object.values(r.initial_presets))assert.equal(Object.values(p).reduce((a,b)=>a+b,0),100);
 assert.equal(r.metadata.fixed_population,false);
});
test('original town still starts with its own six type roster',()=>{
 const t=new Tissue(11);assert.equal(t.cells.length,100);assert.equal(Object.keys(TYPES).length,6);
 assert.equal(t.cells.filter(c=>c.reserve).length,6);
 assert.equal(r.initial_presets.healthy_demonstration.neutrophil??0,0);
});
test('generic macrophage is not automatically renamed as resident',()=>{
 assert.equal(r.cell_types.macrophage,undefined);
 assert.throws(()=>prepareAdvisoryBatch(kernel(),[{...fixture,cell:{...fixture.cell,type:'macrophage'}}],epoch));
});
test('frozen snapshots are copies and cannot mutate callers',()=>{
 const raw=structuredClone(fixture),f=freezeSnapshot(raw);assert.ok(Object.isFrozen(f.cell));
 assert.throws(()=>{f.cell.resources.energy=0;});assert.equal(raw.cell.resources.energy,1);
});
test('advisory preflight supports only actually licensed actions',()=>{
 const k=kernel(),b=prepareAdvisoryBatch(k,[fixture],epoch);
 assert.deepEqual(b.batch.cells[0].allowed,['EPITHELIAL_CXCL8_INDUCTION']);assert.equal(k.events.size,0);
 assert.equal(b.batch.policy,'advisory_only');
});
test('no available host capability means no inferred permissions',()=>{
 const k=new RuleKernel(r),b=prepareAdvisoryBatch(k,[fixture],epoch);
 assert.equal(b.batch.cells.length,0);assert.ok(b.diagnostics[0].candidates.every(a=>!a.allowed));
});
test('preflight filters irrelevant fields rather than leaking tissue map',()=>{
 const s=structuredClone(fixture);s.context.entire_tissue='secret';s.context.patient_name='secret';
 const b=prepareAdvisoryBatch(kernel(),[s],epoch).batch;
 assert.ok(!JSON.stringify(b).includes('secret'));assert.ok(!JSON.stringify(b).includes('patient_name'));
});
test('preflight never silently creates missing score values',()=>{
 const s=structuredClone(fixture);delete s.cell.programs.inflammation;
 assert.throws(()=>prepareAdvisoryBatch(kernel(),[s],epoch),e=>e.code==='MISSING_SCORE_FEATURE');
});
test('preflight rejects missing provenance',()=>{
 const s=structuredClone(fixture);delete s.provenance;assert.throws(()=>prepareAdvisoryBatch(kernel(),[s],epoch));
});
test('preflight rejects duplicate cell identifiers',()=>{
 assert.throws(()=>prepareAdvisoryBatch(kernel(),[fixture,fixture],epoch));
});
test('preflight requires one shared snapshot revision',()=>{
 assert.throws(()=>prepareAdvisoryBatch(kernel(),[{...fixture,revision:1}],epoch));
});
test('a complete advisory reply passes but is not a commit instruction',()=>{
 const b=build(),x=validateCompleteChannelReply(b,good(b),epoch);assert.equal(x.causal_execution_permitted,false);
});
test('empty reply for nonempty request is rejected',()=>{
 const b=build(),v=good(b);v.decisions=[];reject(b,v);
});
test('reference helper accepts omission, integration wrapper closes that gap',()=>{
 const b=build();assert.equal(validateProviderResponse(b,{tick:0,revision:0,decisions:[]}),true);
 reject(b,{run_id:epoch.run_id,tick:0,revision:0,decisions:[]});
});
test('same tick and revision from another reset is rejected',()=>{
 const b=build();reject(b,good(b),{...epoch,run_id:'run_b'});
});
test('stale global tissue revision is rejected even if source cell did not change',()=>{
 const b=build();reject(b,good(b),{...epoch,revision:1});
});
test('time advance without a revision update also invalidates reply',()=>{
 const b=build();reject(b,good(b),{...epoch,time_min:1});
});
test('unknown cell rejected',()=>{
 const b=build(),v=good(b);v.decisions[0].id='other';reject(b,v);
});
test('duplicate channel rejected',()=>{
 const b=build(),v=good(b);v.decisions.push(v.decisions[0]);reject(b,v);
});
test('illegal action rejected',()=>{
 const b=build(),v=good(b);v.decisions[0].choice='ISC_CYCLE';reject(b,v);
});
test('wrong channel rejected',()=>{
 const b=build(),v=good(b);v.decisions[0].channel='cycle';reject(b,v);
});
test('provider cannot override duration, hazard or effects',()=>{
 for(const key of ['duration','hazard','effects','latency','duration_min','rate']){
  const b=build(),v=good(b);v.decisions[0][key]=0;reject(b,v);
 }
});
test('unexpected top level clock rejected',()=>{
 const b=build(),v=good(b);v.duration=0;reject(b,v);
});
test('reported probabilities preserved without becoming biological rates',()=>{
 const b=build(),v=good(b);v.decisions[0].probabilities={EPITHELIAL_CXCL8_INDUCTION:1};v.decisions[0].confidence=.8;
 const copy=structuredClone(v);assert.deepEqual(validateCompleteChannelReply(b,v,epoch).decisions,copy.decisions);assert.deepEqual(v,copy);
});
test('invalid or incomplete distributions rejected',()=>{
 for(const p of [{},{other:1},{EPITHELIAL_CXCL8_INDUCTION:NaN},{EPITHELIAL_CXCL8_INDUCTION:.7}]){
  const b=build(),v=good(b);v.decisions[0].probabilities=p;reject(b,v);
 }
});
test('nonfinite or boolean confidence rejected',()=>{
 for(const confidence of [true,NaN,Infinity,-1,2]){const b=build(),v=good(b);v.decisions[0].confidence=confidence;reject(b,v);}
});
test('one cell can have one response for each of two separate channels',()=>{
 const b={...epoch,policy:'advisory_only',cells:[{id:'cell_200',allowed:['MOVE','SECRETE'],channels:{MOVE:'motility',SECRETE:'induction'}}]};
 const v=good(b);assert.equal(validateCompleteChannelReply(b,v,epoch).decisions.length,2);
 v.decisions.pop();reject(b,v);
});
test('stable string identifiers are not artificially capped at 99',()=>{
 const b=build();b.cells[0].id='descendant_200';assert.equal(validateCompleteChannelReply(b,good(b),epoch).decisions[0].id,'descendant_200');
});
test('empty request legitimately receives no decisions',()=>{
 const b={...epoch,cells:[]};assert.deepEqual(validateCompleteChannelReply(b,good(b),epoch).decisions,[]);
});
test('preflight leaves main tissue physics unchanged',()=>{
 const t=new Tissue(5),before=JSON.stringify(t.export());prepareAdvisoryBatch(kernel(),[fixture],epoch);
 assert.equal(JSON.stringify(t.export()),before);
});
