import test from 'node:test';
import assert from 'node:assert/strict';
import {Tissue,RNG,TYPES,MENUS,GRID,parsePrompt,surface,surfaceAnchors,sample,validateDecision} from '../src/engine.mjs';
import {activationFor,ACTIVATION_POLICY} from '../src/activation.mjs';
const sum=f=>f.reduce((a,b)=>a+b,0);
const stable=t=>JSON.stringify({rng:t.rng.state,cells:t.cells,slots:t.slots,fields:Object.fromEntries(Object.entries(t.fields).map(([k,f])=>[k,Array.from(f)])),tick:t.tick,revision:t.revision,records:t.records});
const rounds=(t,n)=>{for(let i=0;i<n;i++)t.step();return t;};
const mockRemote=p=>Object.fromEntries(p.cells.filter(c=>c.active&&c.legal.length>1).map(c=>[c.id,{action:c.legal[0],weights:Object.fromEntries(c.legal.map(a=>[a,a===c.legal[0]?1:0])),confidence:1}]));
function stromaMass(f){let n=0;for(let y=0;y<GRID.h;y++)for(let x=0;x<GRID.w;x++)if(y/(GRID.h-1)>=surface(x/(GRID.w-1)))n+=f[y*GRID.w+x];return n;}

test('100 unique modeled cells with the declared populations',()=>{const t=new Tissue();assert.equal(t.cells.length,100);assert.equal(new Set(t.cells.map(c=>c.id)).size,100);for(const [k,v]of Object.entries(TYPES))assert.equal(t.cells.filter(c=>c.type===k).length,v.n);});
test('vascular reserve is part of the initial 100',()=>{const t=new Tissue();assert.equal(t.metrics.reserve,6);assert.equal(t.metrics.inTissue,94);assert.ok(t.cells.filter(c=>c.reserve).every(c=>c.type==='neutrophil'));});
test('epithelial anchors follow one continuous surface',()=>{const t=new Tissue();for(const c of t.cells.filter(c=>c.slot!==null))assert.ok(Math.abs(c.y-surface(c.x))<1e-10);});
test('epithelial anchors use approximately equal surface arc length',()=>{const a=surfaceAnchors();const d=a.slice(1).map((p,i)=>Math.hypot((p.x-a[i].x)*16,(p.y-a[i].y)*10));assert.ok(Math.max(...d)/Math.min(...d)<1.08);});
test('300 unperturbed cycles keep all cells and no inflammation',()=>{const t=rounds(new Tissue(),300);assert.equal(t.metrics.alive,100);assert.equal(t.metrics.barrier,1);assert.equal(sum(t.fields.cytokine),0);assert.equal(sum(t.fields.danger),0);assert.equal(sum(t.fields.chemokine),0);});
test('basal stability is not dependent on one seed',()=>{for(const seed of [0,1,42,2026,4294967295]){const t=rounds(new Tissue(seed),35);assert.equal(t.metrics.alive,100);assert.equal(t.metrics.barrier,1);assert.equal(t.metrics.inflammation,0);}});
test('same seed and interventions reproduce an entire episode',()=>{const a=new Tissue(71),b=new Tissue(71);for(const t of [a,b]){rounds(t,2);t.inject('tear',.25,.8);t.inject('pathogen',.25,.8);rounds(t,35);}assert.equal(stable(a),stable(b));});
test('different seeds produce different starting stromal layouts',()=>assert.notEqual(stable(new Tissue(11)),stable(new Tissue(12))));
test('critical epithelial cell cannot choose maintain after the menu gate',()=>{const t=new Tissue(),c=t.cells[0];c.health=10;const p=t.plan().cells.find(p=>p.id===0);assert.deepEqual(p.legal,['apoptosis']);for(let i=0;i<1000;i++)assert.equal(t.localChoice(p,new RNG(i)).action,'apoptosis');});
test('all sampled local choices respect all context menus',()=>{const t=new Tissue();t.inject('tear',.5,.8);t.inject('pathogen',.25,1);for(let i=0;i<70;i++){const p=t.plan();for(const c of p.cells){const d=t.localChoice(c,new RNG(i*100+c.id));assert.ok(c.legal.includes(d.action));assert.ok(Object.keys(d.weights).every(a=>c.legal.includes(a)));}t.step();}});
test('normal healthy epithelial cells cannot choose apoptosis',()=>{const t=new Tissue();for(const p of t.plan().cells.filter(c=>['enterocyte','goblet'].includes(c.type)))assert.ok(!p.legal.includes('apoptosis'));});
test('NK cytotoxicity requires an actual local marked target',()=>{const t=new Tissue(),nk=t.cells.find(c=>c.type==='nk');assert.ok(t.menuFor(nk).attack);const target=t.cells[12];nk.x=target.x;nk.y=target.y+.04;target.health=30;assert.ok(t.menuFor(nk).attack);target.targetMarked=true;assert.equal(t.menuFor(nk).attack,null);});
test('a sterile tear creates danger, but no pathogen',()=>{const t=new Tissue();t.inject('tear',.25,.8);assert.equal(t.metrics.alive,98);assert.equal(sum(t.fields.pathogen),0);assert.ok(sum(t.fields.danger)>0);rounds(t,12);assert.equal(sum(t.fields.pathogen),0);});
test('initial pathogen placement is confined to the lumen',()=>{const t=new Tissue();t.inject('pathogen',.25,.8);assert.equal(stromaMass(t.fields.pathogen),0);assert.ok(sum(t.fields.pathogen)>0);});
test('an open gap increases pathogen passage in the diffusion operator',()=>{const a=new Tissue(),b=new Tissue();a.inject('pathogen',.25,1);b.inject('tear',.25,1);b.fields.pathogen=a.fields.pathogen.slice();let fa=a.fields.pathogen,fb=b.fields.pathogen;for(let i=0;i<8;i++){fa=a.diffuseField(fa,.145,0,true);fb=b.diffuseField(fb,.145,0,true);}const intact=stromaMass(fa),breach=stromaMass(fb);assert.ok(breach>intact*20,`${breach} versus ${intact}`);});
test('diffusion without decay conserves mass away from clipping',()=>{const t=new Tissue(),f=new Float32Array(GRID.w*GRID.h);f[300]=.5;f[450]=.25;const o=t.diffuseField(f,.2,0);assert.ok(Math.abs(sum(o)-sum(f))<1e-6);});
test('all scalar fields stay finite and between zero and one',()=>{const t=new Tissue();for(const name of ['pathogen','tear','flare','particle'])t.inject(name,.5,1);rounds(t,60);for(const f of Object.values(t.fields))assert.ok([...f].every(v=>Number.isFinite(v)&&v>=0&&v<=1));});
test('repair matrix persists across a summary calculation',()=>{const t=new Tissue();t.inject('tear',.25,.8);const slot=t.slots.find(s=>!t.cells[s.cell].alive),fib=t.cells.find(c=>c.type==='fibroblast');fib.x=slot.x;fib.y=slot.y+.065;const p=t.plan(),d=mockRemote(p);d[fib.id]={action:'matrix',weights:Object.fromEntries(p.cells.find(c=>c.id===fib.id).legal.map(a=>[a,a==='matrix'?1:0])),confidence:1};t.commit(p,d,'jev');const seal=slot.seal;assert.ok(seal>0);t.summarize();assert.equal(slot.seal,seal);assert.equal(t.cells[slot.cell].alive,false);});
test('recruitment consumes preexisting reserves and creates no IDs',()=>{const t=rounds(new Tissue(),1);t.inject('pathogen',.25,1);rounds(t,40);assert.ok(t.metrics.reserve<6);assert.equal(t.cells.length,100);assert.ok(t.cells.every(c=>c.id<100));});
test('removing external sources does not erase existing damage or pathogen',()=>{const t=new Tissue();t.inject('tear',.25,.8);t.inject('pathogen',.25,.8);t.inject('particle',.75,.5);const f=sum(t.fields.pathogen),d=sum(t.fields.danger);t.inject('resolve');assert.equal(t.sources.length,0);assert.equal(sum(t.fields.pathogen),f);assert.equal(sum(t.fields.danger),d);assert.equal(t.metrics.alive,98);});
test('communication toggle gates future secretion, not previous chemicals',()=>{const t=new Tissue();t.inject('pathogen');rounds(t,5);const chemo=sum(t.fields.chemokine);t.setCommunication(false);assert.equal(sum(t.fields.chemokine),chemo);for(const p of t.plan().cells)assert.ok(p.legal.every(a=>!['alarm','recruit','cytokine'].includes(a)));});
test('all motile active cells remain beneath the tissue surface',()=>{const t=new Tissue();t.inject('pathogen');rounds(t,80);for(const c of t.cells.filter(c=>c.alive&&c.slot===null&&!c.reserve)){assert.ok(c.y>=surface(c.x)+.044);assert.ok(c.x>=.04&&c.x<=.96);}});
test('taking observations and summaries consumes no decision RNG',()=>{const t=new Tissue();const r=t.rng.state;for(let i=0;i<30;i++){t.summarize();for(const c of t.cells)t.observe(c);}assert.equal(t.rng.state,r);});
test('missing Jev decisions reject the whole round without world mutation',()=>{const t=new Tissue();t.inject('pathogen');const p=t.plan(),before=stable(t);assert.throws(()=>t.commit(p,{},'jev'),/Missing/);assert.equal(stable(t),before);});
test('invalid late Jev answer cannot partly apply earlier decisions',()=>{const t=new Tissue();t.inject('pathogen');const p=t.plan(),d=mockRemote(p),ids=Object.keys(d);d[ids.at(-1)].action='invent_a_cell';const before=stable(t);assert.throws(()=>t.commit(p,d,'jev'));assert.equal(stable(t),before);});
test('stale decision snapshots are rejected',()=>{const t=new Tissue(),p=t.plan();t.inject('tear');const before=stable(t);assert.throws(()=>t.commit(p,{},'local'),/Stale/);assert.equal(stable(t),before);});
test('a probability distribution is required for an actual Jev choice',()=>{const p={id:4,legal:['rest','patrol']};assert.throws(()=>validateDecision(p,{action:'rest'}));assert.throws(()=>validateDecision(p,{action:'rest',weights:{rest:.2,patrol:.2}}));assert.throws(()=>validateDecision(p,{action:'rest',weights:{rest:.2,patrol:.8}}));});
test('valid Jev choices keep model distribution, confidence and model identifier',()=>{const t=new Tissue();t.inject('pathogen');const p=t.plan(),d=mockRemote(p);t.commit(p,d,'jev',{model:'test-only-version',calls:2,inputTokens:99});const id=Number(Object.keys(d)[0]);assert.deepEqual(t.cells[id].weights,d[id].weights);assert.equal(t.cells[id].confidence,1);assert.equal(t.records.at(-1).model,'test-only-version');assert.equal(t.apiCalls,2);});
test('local counters do not claim any API calls',()=>{const t=new Tissue();t.inject('pathogen');rounds(t,10);assert.equal(t.apiCalls,0);assert.equal(t.apiTokens,0);assert.equal(t.totalDecisions,1000);});
test('history snapshots do not alias live cells or fields',()=>{const t=new Tissue(),f=t.history[0];t.inject('pathogen');rounds(t,3);assert.equal(f.tick,0);assert.equal(sum(f.fields.pathogen),0);assert.equal(f.cells[12].health,100);});
test('visual history is bounded to 121 frames',()=>{const t=rounds(new Tissue(),135);assert.equal(t.history.length,121);assert.equal(t.history[0].tick,15);});
test('exported episode has actual inputs and no credential fields',()=>{const t=new Tissue();t.inject('pathogen');t.step();const e=t.export();assert.equal(e.seed,t.seed);assert.equal(e.interventions.length,1);assert.equal(e.records[0].decisions.length,100);assert.ok(!JSON.stringify(e).includes('API_KEY'));});
test('supported prompts map only to declared interventions',()=>{for(const [text,kind] of [['Bacteria arrived on the right','pathogen'],['A sterile tear','tear'],['A Crohn like flare','flare'],['A microplastic particle','particle'],['Remove external triggers','resolve']])assert.equal(parsePrompt(text).kind,kind);});
test('unknown prompts are rejected, not invented',()=>assert.equal(parsePrompt('Give the village an orchestra').valid,false));
test('compound prompts report the limited interpretation',()=>assert.ok(parsePrompt('A bacterial breach').note.includes('separately')));
test('extreme legal seed values are reproducible',()=>{for(const seed of [0,4294967295])assert.equal(stable(new Tissue(seed)),stable(new Tissue(seed)));});

test('every chemical activation threshold has an explicit strict boundary',()=>{
 const c={reserve:false},quiet={pathogen:0,danger:0,chemokine:0,cytokine:0,health:100,corpseId:null};
 for(const code of ['pathogen','danger','chemokine','cytokine']){
  const threshold=ACTIVATION_POLICY[code];
  assert.equal(activationFor(c,{...quiet,[code]:threshold}).active,false);
  assert.equal(activationFor(c,{...quiet,[code]:threshold+1e-6}).reasons[0].code,code);
 }
 assert.equal(activationFor(c,{...quiet,health:94}).active,false);
 assert.equal(activationFor(c,{...quiet,health:93.99}).reasons[0].code,'injury');
});
test('healthy neighbors never activate a quiet tissue, including after maintenance',()=>{
 const t=new Tissue();rounds(t,12);
 assert.ok(t.plan().cells.every(p=>!p.active&&p.activation.reasons.length===0));
 assert.equal(t.firstDeparture,undefined);
 assert.equal(t.metrics.active,0);
});
test('altered neighbors and debris activate locally even without chemical fields',()=>{
 const t=new Tissue(),observer=t.cells.find(c=>c.type==='macrophage'),neighbor=t.cells.find(c=>c.type==='nk');
 observer.x=.5;observer.y=.8;neighbor.x=.52;neighbor.y=.8;
 const read=()=>t.plan().cells.find(c=>c.id===observer.id);
 assert.equal(read().active,false);
 neighbor.health=90;
 assert.ok(read().activation.reasons.some(r=>r.code==='neighbor'&&r.cellId===neighbor.id));
 assert.equal(read().observation.nearbyStressedCell,true);
 neighbor.x=.9;assert.equal(read().active,false);
 neighbor.x=.52;neighbor.alive=false;neighbor.corpse=true;
 assert.ok(read().activation.reasons.some(r=>r.code==='debris'&&r.cellId===neighbor.id));
 assert.ok(read().legal.includes('debris'));
 neighbor.corpse=false;assert.equal(read().active,false);
});
test('marked targets activate a nearby NK cell without a global alarm',()=>{
 const t=new Tissue(),nk=t.cells.find(c=>c.type==='nk'),target=t.cells[12];
 nk.x=target.x;nk.y=target.y+.05;target.health=40;target.targetMarked=true;
 const p=t.plan().cells.find(c=>c.id===nk.id);
 assert.ok(p.active&&p.legal.includes('attack'));
 assert.ok(p.activation.reasons.some(r=>r.code==='neighbor'));
 assert.ok(Object.values(t.fields).every(f=>sum(f)===0));
});
test('vascular reserves require chemokine at the vessel, not distant tissue injury',()=>{
 const c={reserve:true},o={health:10,pathogen:1,danger:1,cytokine:1,chemokine:.0025,nearbyGap:true,nearbyStressedCell:true,corpseId:1};
 assert.equal(activationFor(c,o).active,false);
 assert.deepEqual(activationFor(c,{...o,chemokine:.003}).reasons.map(r=>r.code),['chemokine']);
});
test('Apply records where baseline first broke without executing a cell decision',()=>{
 const t=new Tissue(),before=JSON.stringify(t.history[0]);t.step();const quiet=JSON.stringify(t.history.at(-1));
 const rng=t.rng.state;t.inject('pathogen',.25,1);
 const f=t.history.at(-1),active=f.cells.filter(c=>c.sensing?.activation.active);
 assert.ok(active.length>0&&active.length<20);
 assert.equal(t.rng.state,rng);assert.equal(t.tick,1);assert.equal(t.records.length,1);
 assert.ok(active.every(c=>!c.activation.active&&c.sensing.activation.reasons.some(r=>r.code==='pathogen')));
 assert.equal(f.firstDeparture.tick,1);assert.deepEqual(f.firstDeparture.cells.map(c=>c.id),active.map(c=>c.id));
 assert.equal(JSON.stringify(t.history[0]),before);
 assert.ok(JSON.parse(quiet).cells.every(c=>!c.sensing.activation.active));
 const audit=JSON.stringify(f.firstDeparture);t.step();assert.equal(JSON.stringify(t.firstDeparture),audit);
});
test('removing a source does not erase residual local activation or its first detection',()=>{
 const t=new Tissue();t.inject('particle',.5,1);const first=JSON.stringify(t.firstDeparture);
 assert.ok(t.metrics.active>0);t.inject('resolve');
 assert.equal(t.sources.length,0);assert.ok(t.history.at(-1).cells.some(c=>c.sensing?.activation.active));
 assert.equal(JSON.stringify(t.firstDeparture),first);
});
test('activation evidence is retained separately for decision and post-round sensing',()=>{
 const t=new Tissue();t.inject('pathogen',.25,1);const plan=t.plan(),rng=t.rng.state;
 for(let i=0;i<5;i++)t.plan();assert.equal(t.rng.state,rng);
 t.commit(plan,mockRemote(plan),'jev',{model:'offline-test',calls:0});
 for(const d of t.records.at(-1).decisions){
  assert.deepEqual(d.activation,plan.cells.find(c=>c.id===d.id).activation);
  assert.equal(d.source==='Jev',d.activation.active&&d.legal.length>1);
 }
 const frame=JSON.stringify(t.history.at(-1));t.step();assert.equal(JSON.stringify(t.history.at(-2)),frame);
 assert.equal(t.export().config.activationPolicy.version,'local-cues-v1');
});
test('communication changes refresh recorded legal menus before the next cycle',()=>{
 const t=new Tissue();t.inject('pathogen',.25,1);t.setCommunication(false);
 assert.ok(t.history.at(-1).cells.filter(c=>c.alive).every(c=>c.sensing.legal.every(a=>!['alarm','recruit','cytokine'].includes(a))));
});
