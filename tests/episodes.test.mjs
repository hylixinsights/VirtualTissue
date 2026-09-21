import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {UnifiedTissue,parsePerturbation} from '../src/unified-host.mjs';
import {ACTIVE_PACK,scenarioById} from '../src/tissue-pack.mjs';
import {EpisodeRecorder,encodeEpisode,decodeEpisode} from '../src/episode.mjs';
import {fixtureProvider} from '../src/fixture-provider.mjs';
const advance=async(t,n,p=fixtureProvider)=>{while(n){let k=Math.min(n,60);await t.advance(k,p);n-=k;}};
test('ETEC is parsed independently from EPEC; unsupported mechanisms stay explicit',()=>{assert.deepEqual(parsePerturbation('ETEC enters').kinds,['etec']);assert.deepEqual(parsePerturbation('EPEC enters').kinds,['epec']);assert.equal(parsePerturbation('A virus enters').valid,false);});
test('ETEC colonization produces local apical toxins, not EPEC lesions or direct water',async()=>{const t=new UnifiedTissue();t.inject('etec');assert.equal(t.fields.amount('LT'),0);await advance(t,40,async r=>({...await fixtureProvider(r),decisions:Object.fromEntries(r.cells.map(c=>[c.id,{action:'WAIT',weights:Object.fromEntries(c.actions.map(a=>[a,Number(a==='WAIT')])),confidence:1,source:'Jev'}]))}));assert(t.fields.amount('LT')>0&&t.fields.amount('ST')>0);assert(t.lab.bacteria.some(b=>b.species==='ETEC'&&b.state==='attached'));assert(t.slots.every(s=>s.junction===1));assert(t.lab.patches.every(p=>p.brush===1));assert.equal(t.lab.etecWater,0);assert(Math.max(...t.cells.filter(c=>c.x<.4).map(c=>t.local(c).LT))>10*Math.max(...t.cells.filter(c=>c.x>.8).map(c=>t.local(c).LT)));assert(t.cells.filter(c=>c.slot===null).every(c=>t.local(c).LT===0));assert.equal(t.lab.events.length,0);assert.equal(t.auditLab().bacteria.residual,0);});
test('ETEC water follows a completed individual choice and conserves the reservoir ledger',async()=>{const t=new UnifiedTissue();t.inject('etec');await advance(t,80);assert(t.lab.etecWater>0);const done=[...t.kernel.events.values()].filter(e=>e.action_id==='EPITHELIAL_ION_SECRETION'&&e.status==='acknowledged');assert(done.length>0);for(const e of done){assert(e.acknowledged_at>=e.started_at+e.duration_min);assert(t.decisions.some(d=>d.event_id===e.id));}assert(Math.abs(t.auditLab().water.systemResidual)<1e-9);for(const k of ['LT','ST'])assert(Math.abs(t.fields.audit()[k].residual)<1e-9);});
test('a pack changes the real population, competence and host sensing parameters',()=>{const p=structuredClone(ACTIVE_PACK);p.population=p.population.filter(c=>['cell-000','cell-001','cell-002','cell-070'].includes(c.id));p.definition.host_parameters={neighbor_radius:.001};p.population[0].competence.CXCL8_output=false;const t=new UnifiedTissue(4,p);assert.equal(t.cells.length,4);assert.equal(t.slots.length,3);assert.equal(t.rules.neighbor_radius,.001);assert.equal(t.cells[0].state.competence.CXCL8_output,false);assert.equal(t.metrics.present,4);assert.equal(t.plan().request.pack_fingerprint,p.fingerprint);});
test('recording starts before input and keeps baseline after live history has rolled over',async()=>{const t=new UnifiedTissue(),rec=new EpisodeRecorder(t,{provider:'fixture',scenario:scenarioById('baseline')});await advance(t,130);const e=rec.finish();assert.equal(t.history.length,121);assert.equal(e.frames[0].time_min,0);assert.equal(e.frames[0].lab.bacteria.length,0);assert.equal(e.frames.at(-1).time_min,130);assert.equal(e.decisions.length,0);assert.equal(e.metadata.calls,0);assert.equal(e.metadata.status,'complete');});
test('every decision retains exact pre-choice snapshots, menus, response and executed receipt',async()=>{const t=new UnifiedTissue(),rec=new EpisodeRecorder(t,{provider:'fixture',frame_interval_min:30});t.inject('etec');const originals=[];await advance(t,50,async r=>{originals.push(structuredClone(r));return fixtureProvider(r);});const e=rec.finish();assert.deepEqual(e.rounds.map(r=>r.request),originals);assert.equal(e.decisions.length,originals.reduce((n,r)=>n+r.cells.length,0));for(const round of e.rounds)for(const c of round.request.cells){assert(round.observations.some(o=>o.cell_id===t.cells[c.id].id));assert(round.response.decisions[c.id]);}assert(e.transactions.some(v=>v.plan.action_id==='EPITHELIAL_ION_SECRETION'));assert(e.frames.length<e.rounds.length);const encoded=await encodeEpisode(e);assert.deepEqual(await decodeEpisode(encoded),e);});
test('reset creates a fresh epoch, fields, inventories, decisions, antigen and recording',async()=>{const a=new UnifiedTissue(),rec=new EpisodeRecorder(a,{provider:'fixture'});a.inject('etec');await advance(a,30);rec.finish();const b=new UnifiedTissue(a.seed),r=new EpisodeRecorder(b,{provider:'fixture'});assert.notEqual(b.run_id,a.run_id);assert.equal(b.time_min,0);assert.equal(b.decisions.length,0);assert.equal(b.fields.amount('LT'),0);assert.equal(b.lab.bacteria.length,0);assert.equal(b.lab.balance.waterDrawn,0);assert(b.cells.every(c=>c.v5.antigens.length===0));assert.equal(r.data.rounds.length,0);assert.throws(()=>new EpisodeRecorder(a),/fresh tissue/);});
test('failed provider saves partial evidence and never fabricates a successful answer',async()=>{const t=new UnifiedTissue(),rec=new EpisodeRecorder(t,{provider:'jev'});t.cells[0].health=80;t.cells[0].state.memory.alarm=.8;await assert.rejects(t.advance(1,async()=>{const e=Error('upstream failed');e.meta={calls:1,inputTokens:10};throw e;}));const e=rec.finish('partial','upstream failed');assert.equal(e.metadata.status,'partial');assert.equal(e.metadata.duration_min,0);assert.equal(e.rounds.length,0);assert.equal(e.decisions.length,0);assert.equal(e.metadata.calls,1);assert.equal(e.request_audit[0].status,'failed');assert.equal(e.frames.at(-1).cells[0].health,80);});
test('archive corruption is detected before playback',async()=>{const t=new UnifiedTissue(),rec=new EpisodeRecorder(t,{provider:'fixture'}),e=rec.finish(),encoded=await encodeEpisode(e);const raw=JSON.parse(await new Response(new Blob([encoded]).stream().pipeThrough(new DecompressionStream('gzip'))).text());raw.payload=raw.payload.replace('fixture','jev');await assert.rejects(decodeEpisode(new TextEncoder().encode(JSON.stringify(raw))),/checksum/);});
test('recording limit stops without dropping the accepted stopping round',async()=>{const t=new UnifiedTissue(),rec=new EpisodeRecorder(t,{provider:'fixture',max_bytes:1000000});t.inject('etec');rec.limit=rec.size;await assert.rejects(advance(t,30),/size limit/);const e=rec.finish('partial','size limit');assert.equal(e.frames[0].time_min,0);assert.equal(e.frames.at(-1).time_min,t.time_min);assert.equal(e.decisions.length,e.rounds.reduce((n,r)=>n+r.request.cells.length,0));});
test('shipped examples cover independent complete scenarios with explicit fixture provenance',async()=>{const index=JSON.parse(await readFile(new URL('../recordings/examples/index.json',import.meta.url)));assert.deepEqual(index.map(e=>e.scenario.id),['etec','epec','ibd','baseline']);assert.equal(new Set(index.map(e=>e.run_id)).size,4);for(const entry of index){const e=await decodeEpisode(await readFile(new URL('../recordings/examples/'+entry.file,import.meta.url)));assert.equal(e.metadata.status,'complete');assert.equal(e.metadata.provider,'fixture');assert.equal(e.metadata.calls,0);assert.equal(e.frames[0].lab.bacteria.length,0);assert.equal(e.metadata.duration_min,entry.scenario.duration_min);}});

test('invalid probabilities leave every physical cell, clock, RNG and ledger unchanged and save failure usage',async()=>{
 const t=new UnifiedTissue(),rec=new EpisodeRecorder(t,{provider:'fixture'});t.cells[0].health=80;t.cells[0].state.memory.alarm=.8;
 const physical=()=>JSON.stringify({cells:t.cells,fields:t.fields.values,events:[...t.kernel.events.values()],epoch:t.epoch(),rng:t.rngDraws,lab:t.lab,transactions:[...t.appliedTransactions]});
 const before=physical();
 await assert.rejects(t.advance(1,async request=>{const r=await fixtureProvider(request);r.meta.calls=1;r.meta.inputTokens=13;const d=Object.values(r.decisions)[0];d.weights=Object.fromEntries(Object.keys(d.weights).map(k=>[k,0]));return r;}),/probabilities/);
 assert.equal(physical(),before);assert.equal(t.decisions.length,0);
 const e=rec.finish('partial','Invalid probabilities');assert.equal(e.metadata.calls,1);assert.equal(e.metadata.input_tokens,13);assert.equal(e.rounds.length,0);assert.equal(e.metadata.duration_min,0);assert(e.request_audit.some(r=>r.status==='failed'));
});
test('removed inputs are rejected atomically and unsupported pathways are never eligible',()=>{
 const t=new UnifiedTissue(),before=JSON.stringify(t.export());
 for(const kind of ['lactose','lactose_control']){assert.throws(()=>t.inject(kind));assert.equal(JSON.stringify(t.export()),before);}
 assert.equal(parsePerturbation('ETEC and lactose').valid,false);
 for(const c of t.cells)for(const row of t.candidates(c))if(!ACTIVE_PACK.manual.supported_actions.includes(row.action_id))assert.equal(row.allowed,false);
 assert.equal(t.registry.metadata.version,'3.0.0');
});

test('direct injury records strong local cell and barrier damage without inventing toxins',async()=>{
 const {tissueReadouts,barrierDamage,signalExplanation,mostAffectedCell}=await import('../src/tissue-readouts.mjs');
 const t=new UnifiedTissue();t.inject('injury',.5);const f=t.history.at(-1),r=tissueReadouts(f);
 assert.equal(r.injured,6);assert.equal(r.barrierDamage,.8);assert.equal(r.cellDamage,.8);assert.equal(r.LT,0);assert.equal(r.ST,0);
 assert.equal(barrierDamage(f,mostAffectedCell(f,'BARRIER_DAMAGE')),.8);
 assert.match(signalExplanation(f,'LT'),/produced by ETEC/);assert.match(signalExplanation(f,'BARRIER_DAMAGE'),/6 injured junctions/);
 const c=f.cells.find(c=>c.state.type==='fibroblast');assert.equal(barrierDamage(f,c),null);
});
test('ETEC toxins reach recorded apical field maps without changing physical state during display',async()=>{
 const {GRID,surface}=await import('../src/engine.mjs');
 const {tissueReadouts,signalExplanation}=await import('../src/tissue-readouts.mjs');
 const t=new UnifiedTissue();t.inject('etec');await advance(t,40);
 const f=t.history.at(-1);assert(tissueReadouts(f).LT>0);assert(tissueReadouts(f).ST>0);
 for(const name of ['LT','ST']){
  assert.equal(f.fields[name].length,GRID.w*GRID.h);assert(f.fields[name].some(v=>v>0));
  f.fields[name].forEach((v,i)=>{assert(Number.isFinite(v)&&v>=0&&v<=1);const x=(i%GRID.w)/(GRID.w-1),y=Math.floor(i/GRID.w)/(GRID.h-1);if(y>=surface(x))assert.equal(v,0);});
 }
 const before=JSON.stringify(t.export());t.fields.display();tissueReadouts(f);signalExplanation(f,'LT');assert.equal(JSON.stringify(t.export()),before);
 assert.match(signalExplanation(f,'LT'),/peak epithelial exposure/);
});
test('older recordings retain exact toxin readouts without inventing a missing field map',async()=>{
 const {tissueReadouts,signalExplanation,formatReading}=await import('../src/tissue-readouts.mjs');
 const index=JSON.parse(await readFile(new URL('../recordings/examples/index.json',import.meta.url)));
 const e=await decodeEpisode(await readFile(new URL('../recordings/examples/'+index[0].file,import.meta.url)));
 const f=structuredClone(e.frames.at(-1));delete f.fields.LT;
 const before=JSON.stringify(f);assert(tissueReadouts(f).LT>0);assert.match(signalExplanation(f,'LT'),/older recording has no toxin field map/);assert.equal(JSON.stringify(f),before);
 assert.equal(formatReading(.00000003),'3.00e-8');assert.equal(formatReading(0),'0');
});
