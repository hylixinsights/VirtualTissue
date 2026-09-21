import test from 'node:test';
import assert from 'node:assert/strict';
import {ManualTissue, MANUAL_HANDLERS, parseManualPrompt, manualCoverage} from '../src/manual-host.mjs';
import {CompartmentFields} from '../src/manual-fields.mjs';
import {Tissue} from '../src/engine.mjs';
import {sampleCompeting, seededRandom} from '../manual_v2/virtual_tissue_kernel.mjs';

const near=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function ready(type='goblet',action='GOBLET_RELEASE'){
  const t=new ManualTissue(71),c=t.cells.find(c=>c.type===type);
  c.state.memory.alarm=.8;
  t.fields.deposit('SECRETORY_STIMULUS',c.apical,10);
  const duration=action==='GOBLET_RELEASE'?1:30;
  const e=t.kernel.start(action,t.snapshot(c),{initialized_duration:duration});
  t.time_min=duration;t.tick=duration;t.revision++;
  const result=t.kernel.advance(e.id,t.snapshot(c),t.time_min);
  return {t,c,e,plan:{...result,run_id:t.run_id}};
}
const physical=t=>JSON.stringify({cells:t.cells,fields:t.fields.values,fieldLedger:t.fields.ledger,revision:t.revision,ledger:[...t.appliedTransactions]});
function canonical(t){
  return JSON.stringify({cells:t.cells,time:t.time_min,events:[...t.kernel.events],fields:t.fields.values,rngDraws:t.rngDraws,tieDraws:t.tieDraws});
}

test('reduced preset starts at 100 with stable string IDs and explicit inactive generic macrophages',()=>{
  const t=new ManualTissue();assert.equal(t.cells.length,100);assert.equal(new Set(t.cells.map(c=>c.id)).size,100);
  assert.ok(t.cells.every(c=>typeof c.id==='string'));assert.equal(t.metrics.reserve,6);
  const c=t.cells.find(c=>c.type==='macrophage');assert.equal(c.state.type,'macrophage');assert.ok(t.candidates(c).every(r=>!r.allowed));
  assert.equal(t.manifest.initialization.event_history,'Empty; no pre-aged events.');
});
test('quiet baseline has no manual events, extracellular output, recruitment or legacy damage',()=>{
  const t=new ManualTissue();for(let n=0;n<10;n++)t.step(60);
  assert.equal(t.kernel.events.size,0);assert.equal(t.fields.amount('CXCL8'),0);assert.equal(t.fields.amount('MUCUS'),0);
  assert.equal(t.metrics.alive,100);assert.equal(t.metrics.reserve,6);assert.equal(t.metrics.recruited,0);
  assert.ok(t.cells.every(c=>c.health===100));
});
test('Manual host never calls legacy physical step, commit, damage or diffusion',()=>{
  const names=['step','commit','applyDamage','diffuseAll'];const original=names.map(k=>Tissue.prototype[k]);
  try{for(const name of names)Tissue.prototype[name]=()=>{throw new Error('Legacy effect invoked');};
    const t=new ManualTissue();t.inject('combined');t.step(60);
  }finally{names.forEach((k,i)=>Tissue.prototype[k]=original[i]);}
});
test('manual prompt preview identifies exact inputs and rejects pathogen/CASP4 shortcuts',()=>{
  const t=new ManualTissue(),before=physical(t);const p=parseManualPrompt('Both stimuli on the right.');
  assert.ok(p.valid);assert.equal(p.x,.76);assert.match(p.description,/TNF → basal/);assert.match(p.description,/SECRETORY_STIMULUS → apical/);
  assert.equal(physical(t),before);assert.equal(parseManualPrompt('A pathogen activates CASP4').valid,false);
});
test('apply changes only external sources; output, memory, stores and event clocks are not scripted',()=>{
  const t=new ManualTissue(),state=JSON.stringify(t.cells);t.inject('combined');
  assert.equal(JSON.stringify(t.cells),state);assert.equal(t.time_min,0);assert.equal(t.kernel.events.size,0);
  assert.equal(t.sources.length,2);assert.equal(t.fields.amount('TNF'),0);
});
test('snapshots are immutable isolated copies with epoch, physical units and provenance',()=>{
  const t=new ManualTissue(),c=t.cells[0],s=t.snapshot(c);assert.ok(Object.isFrozen(s.cell.memory));
  assert.throws(()=>s.cell.memory.alarm=1,TypeError);c.state.memory.alarm=.5;assert.equal(s.cell.memory.alarm,0);
  assert.equal(s.provenance.source_kind,'proposed_prior');assert.equal(s.run_id,t.run_id);assert.ok(s.context.physical_position.x_um>0);
});
test('missing biology blocks actions with feature-specific diagnostics',()=>{
  const t=new ManualTissue(),c=t.cells[0];c.state.memory.alarm=.8;delete c.state.competence.CXCL8_output;
  const row=t.candidates(c).find(r=>r.action_id==='EPITHELIAL_CXCL8_INDUCTION');
  assert.equal(row.allowed,false);assert.ok(row.gate_details.some(s=>s.includes('MISSING_INPUT: cell.competence.CXCL8_output')));
  assert.equal(t.collectProposals([t.snapshot(c)],60).proposed.length,0);
});
test('missing score does not invent a zero or abort unrelated cells',()=>{
  const t=new ManualTissue(),c=t.cells[0];c.state.memory.alarm=.8;delete c.state.programs.inflammation;
  const row=t.candidates(c).find(r=>r.action_id==='EPITHELIAL_CXCL8_INDUCTION');
  assert.equal(row.allowed,false);assert.ok(row.reasons.some(s=>s.includes('cell.programs.inflammation')));
});
test('no induction completion before its sampled registered duration',()=>{
  const t=new ManualTissue(),c=t.cells[0];c.state.memory.alarm=.8;
  const e=t.kernel.start('EPITHELIAL_CXCL8_INDUCTION',t.snapshot(c));
  assert.ok(e.duration_min>=30&&e.duration_min<=360);
  t.time_min=e.duration_min-.001;const status=t.kernel.advance(e.id,t.snapshot(c));
  assert.equal(status.status,'running');assert.equal(status.duration_min,e.duration_min);
  assert.throws(()=>t.completionPlan(e.id));assert.equal(c.state.outputs.CXCL8,0);
});
test('future starts are never advanced early',()=>{
  const t=new ManualTissue(),c=t.cells[0];c.state.memory.alarm=.8;
  const e=t.kernel.start('EPITHELIAL_CXCL8_INDUCTION',t.snapshot(c),{start_min:.9});
  t.step(.5);assert.equal(t.kernel.getEvent(e.id).last_update,.9);assert.equal(t.kernel.getEvent(e.id).active_elapsed_min,0);
});
test('induction completion raises capacity but does not emit an immediate CXCL8 packet',()=>{
  const {t,c,plan}=ready('enterocyte','EPITHELIAL_CXCL8_INDUCTION');t.commitCompletion(plan);
  assert.equal(c.state.outputs.CXCL8,1);assert.equal(t.fields.amount('CXCL8'),0);
  t.updateContinuous(1);assert.ok(t.fields.amount('CXCL8')>0);assert.ok(t.fields.amount('CXCL8')<=.001);
  near(c.substrate.CXCL8+c.accounting.CXCL8_emitted,1);
});
test('continuous flux is finite, uses elapsed time and cannot consume absent substrate',()=>{
  const t=new ManualTissue(),c=t.cells[0];c.state.outputs.CXCL8=1;c.substrate.CXCL8=.0002;
  t.updateContinuous(1);near(t.fields.amount('CXCL8'),.0002);near(c.substrate.CXCL8,0);
  const before=t.fields.amount('CXCL8');t.updateContinuous(1);near(t.fields.amount('CXCL8'),before);
});
test('goblet completion emits exactly the reserved store once and debits energy once',()=>{
  const {t,c,plan}=ready();const reserved=plan.reserved_costs.find(x=>x.path==='cell.stores.granules').amount;
  t.commitCompletion(plan);near(t.fields.amount('MUCUS'),reserved);near(c.state.stores.granules,1-reserved);near(c.state.resources.energy,.98);
  const before=physical(t);t.commitCompletion(plan);assert.equal(physical(t),before);
});
test('applied transaction ledger prevents effects repeating before acknowledgement',()=>{
  const {t,plan,e}=ready();t.commitCompletion(plan,{acknowledge:false});assert.equal(t.kernel.getEvent(e.id).status,'pending');
  const before=physical(t);t.commitCompletion(plan,{acknowledge:false});assert.equal(physical(t),before);
  t.commitCompletion(plan);assert.equal(t.kernel.getEvent(e.id).status,'acknowledged');assert.equal(physical(t),before);
});
test('a committed receipt is acknowledged before rechecking a now-lost continuation input',()=>{
  const {t,c,plan,e}=ready();t.commitCompletion(plan,{acknowledge:false});c.state.competence.local_secretory_stimulus=false;
  t.step();assert.equal(t.kernel.getEvent(e.id).status,'acknowledged');assert.equal(t.appliedTransactions.size,1);
});
test('failed completion validation changes no host data and retains pending kernel/reservations',()=>{
  const {t,c,plan,e}=ready();c.access.apical=false;const before=physical(t);
  assert.throws(()=>t.commitCompletion(plan),/gate failed/);assert.equal(physical(t),before);
  assert.equal(t.kernel.getEvent(e.id).status,'pending');assert.equal(t.kernel.activeEvents(c.id)[0].reserved_costs.length,2);
  c.access.apical=true;t.commitCompletion(plan);assert.equal(t.appliedTransactions.size,1);
});
test('forged completion payload cannot partially debit resources',()=>{
  const {t,plan}=ready();plan.effects[0].arguments.mediator='CXCL8';const before=physical(t);
  assert.throws(()=>t.commitCompletion(plan),/differs/);assert.equal(physical(t),before);
});
test('cancellation releases reservations without emitting or debiting a store',()=>{
  const t=new ManualTissue(),c=t.cells.find(c=>c.type==='goblet');t.fields.deposit('SECRETORY_STIMULUS',c.apical,10);
  const e=t.kernel.start('GOBLET_RELEASE',t.snapshot(c));near(t.kernel.environment(t.snapshot(c)).cell.stores.granules,.9);
  t.fields.values.SECRETORY_STIMULUS.fill(0);t.time_min=1;const cancelled=t.kernel.advance(e.id,t.snapshot(c));
  assert.equal(cancelled.status,'cancelled');near(c.state.stores.granules,1);near(t.kernel.environment(t.snapshot(c)).cell.stores.granules,1);assert.equal(t.fields.amount('MUCUS'),0);
});
test('independent channels share finite energy reservations',()=>{
  const t=new ManualTissue(),c=t.cells.find(c=>c.type==='goblet');c.state.resources.energy=.21;c.state.memory.alarm=.8;
  t.fields.deposit('SECRETORY_STIMULUS',c.apical,10);const s=t.snapshot(c);
  t.kernel.start('GOBLET_RELEASE',s);assert.throws(()=>t.kernel.start('EPITHELIAL_CXCL8_INDUCTION',s),/legality/);
  near(c.state.resources.energy,.21);
});
test('proposal ordering is global by proposed time with deterministic seeded ties',()=>{
  const t=new ManualTissue();for(const c of t.cells.filter(c=>c.slot!==null))c.state.memory.alarm=.8;
  const snapshots=t.cells.filter(c=>c.slot!==null).map(c=>t.snapshot(c));const {proposed}=t.collectProposals(snapshots,60);
  assert.ok(proposed.length>1);for(let i=1;i<proposed.length;i++)assert.ok(proposed[i].proposed_start_min>=proposed[i-1].proposed_start_min);
});
test('competing reference hazards retain h(a)/sum(h) conditional selection',()=>{
  const rng=seededRandom(73),a=[{action_id:'a',hazard_per_minute:.02},{action_id:'b',hazard_per_minute:.01}];let count=0;
  for(let n=0;n<10000;n++)if(sampleCompeting(a,100000,rng).action_id==='a')count++;
  assert.ok(Math.abs(count/10000-2/3)<.02);
});
test('closed compartment diffusion conserves amount and never crosses the interface',()=>{
  const f=new CompartmentFields(),i=f.nearest(80,50,'apical');f.deposit('MUCUS',i,.1);f.advance(30,{decay:0});near(f.amount('MUCUS'),.1);
  assert.ok(f.values.MUCUS.every((v,i)=>v>=0&&(f.side[i]==='apical'||v===0)));assert.throws(()=>f.deposit('CXCL8',i,1));
});
test('concentration deposition divides by the explicit effective voxel volume',()=>{
  const f=new CompartmentFields();f.volume=2;const i=f.nearest(80,100,'basal');f.deposit('CXCL8',i,.1);
  near(f.values.CXCL8[i],.05);near(f.amount('CXCL8'),.1);
});
test('field decay and source/sink accounting reproduce a 30-minute half-life',()=>{
  const f=new CompartmentFields();f.deposit('CXCL8',f.nearest(80,100,'basal'),1);f.advance(30);near(f.amount('CXCL8'),.5);
  near(f.audit().CXCL8.residual,0);assert.ok(f.values.CXCL8.every(v=>v>=0));
});
test('field refinement agrees and preserves total mass',()=>{
  const a=new CompartmentFields(),b=new CompartmentFields(),i=a.nearest(80,100,'basal');a.deposit('CXCL8',i,1);b.deposit('CXCL8',i,1);
  a.advance(2);for(let n=0;n<20;n++)b.advance(.1);
  near(a.amount('CXCL8'),b.amount('CXCL8'));assert.ok(Math.max(...a.values.CXCL8.map((v,i)=>Math.abs(v-b.values.CXCL8[i])))<.01);
});
test('paired stimulus produces both real accepted host effects with balanced finite pools',()=>{
  const t=new ManualTissue();t.inject('combined');for(let i=0;i<10;i++)t.step(60);
  for(const action of MANUAL_HANDLERS)assert.ok([...t.kernel.events.values()].some(e=>e.action_id===action&&e.status==='acknowledged'));
  assert.ok(t.fields.amount('CXCL8')>0);assert.ok(t.fields.amount('MUCUS')>0);
  for(const f of Object.values(t.fields.audit()))near(f.residual,0,1e-8);
  for(const c of t.cells.filter(c=>c.slot!==null)){
    near(c.substrate.CXCL8+c.accounting.CXCL8_emitted,1);
    near(c.state.resources.energy,1+c.accounting.energy_refilled-c.accounting.energy_spent);
    near(c.substrate.energy+c.accounting.energy_refilled,1);
    if(c.type==='goblet'){near(c.state.stores.granules,1+c.accounting.granules_refilled-c.accounting.granules_emitted);near(c.substrate.granules+c.accounting.granules_refilled,1);}
  }
  assert.ok(t.cells.every(c=>c.health===100));assert.equal(t.metrics.alive,100);assert.equal(t.metrics.reserve,6);
});
test('biological step batching and display-frame frequency do not alter physical trajectories',()=>{
  const a=new ManualTissue(8),b=new ManualTissue(8);a.inject('combined');b.inject('combined');
  for(let i=0;i<120;i++)a.step();b.step(60);b.step(60);assert.equal(canonical(a),canonical(b));
});
test('same seed reproduces physics with a fresh independent run ID',()=>{
  const a=new ManualTissue(4),b=new ManualTissue(4);assert.notEqual(a.run_id,b.run_id);a.inject('combined');b.inject('combined');a.step(60);b.step(60);assert.equal(canonical(a),canonical(b));
});
test('stale advisory responses are rejected by current run, global revision and biological time',()=>{
  const t=new ManualTissue();t.cells[0].state.memory.alarm=.8;const batch=t.advisoryBatch();
  const response={run_id:batch.run_id,tick:batch.tick,revision:batch.revision,decisions:batch.cells.flatMap(c=>Object.entries(c.channels).map(([choice,channel])=>({id:c.id,choice,channel})))};
  assert.equal(t.acceptAdvisory(batch,response).causal_execution_permitted,false);
  t.time_min+=1;assert.throws(()=>t.acceptAdvisory(batch,response),/time advanced/);t.time_min-=1;t.revision++;
  assert.throws(()=>t.acceptAdvisory(batch,response),/revision/);assert.throws(()=>new ManualTissue().acceptAdvisory(batch,response),/different run/);
});
test('export is an audit with events, reservations, ledger and declared non-resumability',()=>{
  const {t,plan}=ready();t.commitCompletion(plan);t.recordFrame();const out=t.export();
  assert.equal(out.resumable,false);assert.equal(out.rule_sha256,t.manifest.rule_hash);assert.equal(out.transactions.length,1);
  assert.equal(out.events[0].status,'acknowledged');assert.equal(out.host_manifest.evidence,'P');assert.equal(out.counters.apiCalls,0);
  assert.equal(manualCoverage().implemented,2);assert.equal(manualCoverage().total,55);assert.ok(out.coverage.actions.filter(a=>!a.implemented).every(a=>a.reason.includes('not a biological impossibility')));
});
