/* Cellville 3D. Illustrative rules only, not a biological predictor.
 * Pure, seeded simulation. Rendering must never mutate this object.
 */
import {activationFor, ACTIVATION_POLICY} from './activation.mjs';
export const VERSION = '3.5.0';
export const GRID = {w:64,h:44};
export const clamp = (v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const isEpi = c=>c.type==='enterocyte'||c.type==='goblet';
export const TYPES = {
 enterocyte:{name:'Enterocyte',color:'#F3BC6A',n:42},
 goblet:{name:'Goblet cell',color:'#65CDBD',n:8},
 fibroblast:{name:'Fibroblast',color:'#B59DD9',n:20},
 macrophage:{name:'Macrophage',color:'#7BAFDF',n:12},
 neutrophil:{name:'Neutrophil',color:'#BFD675',n:10},
 nk:{name:'NK cell',color:'#EF9DB5',n:8}
};
export const ACTIONS = {
 maintain:{label:'Maintain barrier',effect:'Supports its own junction.',icon:'shield'},
 reinforce:{label:'Tighten junction',effect:'Repairs the local junction.',icon:'shield'},
 mucus:{label:'Secrete mucus',effect:'Adds local mucus that limits pathogen contact.',icon:'drop'},
 alarm:{label:'Release alarm',effect:'Adds danger and chemokine near this cell.',icon:'alarm'},
 apoptosis:{label:'Enter apoptosis',effect:'Removes the cell and leaves a local gap.',icon:'fade'},
 rest:{label:'Rest',effect:'Conserves energy.',icon:'rest'},
 patrol:{label:'Patrol',effect:'Moves a short distance inside the tissue.',icon:'move'},
 migrate:{label:'Follow chemokine',effect:'Moves along a local chemokine gradient.',icon:'move'},
 recruit:{label:'Request help',effect:'Adds chemokine. Only vascular reserve cells can enter.',icon:'signal'},
 phagocytose:{label:'Clear pathogen',effect:'Reduces nearby pathogen.',icon:'eat'},
 debris:{label:'Clear debris',effect:'Removes one nearby corpse and some local danger.',icon:'eat'},
 cytokine:{label:'Release cytokine',effect:'Adds a generic inflammatory signal.',icon:'signal'},
 repair:{label:'Release repair factors',effect:'Repairs nearby junctions and damaged living cells.',icon:'heart'},
 matrix:{label:'Deposit repair matrix',effect:'Seals a fraction of a nearby gap without replacing its cell.',icon:'mesh'},
 attack:{label:'Attack marked target',effect:'Damages a nearby marked epithelial target.',icon:'target'},
 enter:{label:'Enter tissue',effect:'Leaves the vessel in response to local chemokine.',icon:'move'}
};
export const MENUS = {
 enterocyte:['maintain','reinforce','alarm','recruit','apoptosis'],
 goblet:['maintain','mucus','alarm','apoptosis'],
 fibroblast:['rest','matrix','repair','cytokine'],
 macrophage:['patrol','migrate','phagocytose','debris','recruit','cytokine','repair'],
 neutrophil:['rest','patrol','migrate','phagocytose','cytokine','apoptosis'],
 nk:['rest','patrol','migrate','attack','cytokine']
};
export const dist = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function surface(x){
 return .485 - .235*Math.exp(-(((x-.25)/.128)**2)) - .235*Math.exp(-(((x-.755)/.128)**2)) + .075*Math.exp(-(((x-.5)/.102)**2));
}
export function surfaceNormal(x){
 const d=(surface(x+.0005)-surface(x-.0005))/.001;
 // 16 x 10 world dimensions, correct metric for the rendered geometry.
 const nx=d*10,ny=-16,len=Math.hypot(nx,ny);
 return {x:nx/len,y:ny/len};
}
export function surfaceAnchors(n=50){
 const a=[];let total=0,prev={x:.035,y:surface(.035)};
 for(let i=0;i<=2400;i++){
  const x=.035+.93*i/2400,y=surface(x);
  if(i)total+=Math.hypot((x-prev.x)*16,(y-prev.y)*10);
  a.push({x,y,s:total});prev={x,y};
 }
 let j=0;
 return Array.from({length:n},(_,i)=>{
  const s=(i+.5)*total/n;while(j<a.length-2&&a[j+1].s<s)j++;
  const f=(s-a[j].s)/(a[j+1].s-a[j].s||1);
  const x=a[j].x+(a[j+1].x-a[j].x)*f;
  return {x,y:surface(x),spacing:total/n};
 });
}
export class RNG {
 constructor(seed){this.state=seed>>>0;}
 next(){this.state=(Math.imul(this.state,1664525)+1013904223)>>>0;return this.state/4294967296;}
 range(a,b){return a+(b-a)*this.next();}
}
export const bin = v=>v<.03?'absent':v<.2?'low':v<.55?'moderate':'high';
const fg = ()=>new Float32Array(GRID.w*GRID.h);
const ix=(x,y)=>y*GRID.w+x;
export function sample(f,x,y){
 const xx=clamp(x)*(GRID.w-1),yy=clamp(y)*(GRID.h-1),a=Math.floor(xx),b=Math.floor(yy),u=xx-a,v=yy-b;
 const c=Math.min(a+1,GRID.w-1),d=Math.min(b+1,GRID.h-1);
 return f[ix(a,b)]*(1-u)*(1-v)+f[ix(c,b)]*u*(1-v)+f[ix(a,d)]*(1-u)*v+f[ix(c,d)]*u*v;
}
function splat(f,x,y,amount,r=.047){
 const gx=x*(GRID.w-1),gy=y*(GRID.h-1);
 const rx=r*GRID.w,ry=r*GRID.h;
 for(let j=Math.max(0,Math.floor(gy-ry*2));j<=Math.min(GRID.h-1,Math.ceil(gy+ry*2));j++)
  for(let i=Math.max(0,Math.floor(gx-rx*2));i<=Math.min(GRID.w-1,Math.ceil(gx+rx*2));i++){
   const d=((i-gx)/rx)**2+((j-gy)/ry)**2;
   if(d<4)f[ix(i,j)]+=amount*Math.exp(-d*1.6);
  }
}
function splatLuminal(f,x,y,amount,r=.035){
 const delta=fg();splat(delta,x,y,amount,r);
 for(let yy=0;yy<GRID.h;yy++)for(let xx=0;xx<GRID.w;xx++)if(yy/(GRID.h-1)<surface(xx/(GRID.w-1))){const i=ix(xx,yy);f[i]+=delta[i];}
}
function normalizeField(f){for(let i=0;i<f.length;i++)f[i]=clamp(f[i]);}
const deepCopy = v=>JSON.parse(JSON.stringify(v));
export class Tissue {
 constructor(seed=20260919){
  this.seed=seed>>>0;this.rng=new RNG(this.seed);this.tick=0;this.revision=0;
  this.fields={pathogen:fg(),danger:fg(),chemokine:fg(),cytokine:fg()};
  this.cells=[];this.slots=[];this.sources=[];this.events=[];this.records=[];this.history=[];this.interventions=[];
  this.providerRequests=[];this.communication=true;this.metrics={};this.totalDecisions=0;this.apiCalls=0;this.apiTokens=0;
  this.initialize();this.summarize();this.recordFrame();
 }
 initialize(){
  const anchors=surfaceAnchors();let gob=0;
  anchors.forEach((a,i)=>{
   const type=([3,9,15,21,28,34,40,46].includes(i))?'goblet':'enterocyte';if(type==='goblet')gob++;
   const c=this.create(type,a.x,a.y);c.slot=i;c.z=.23;c.health=100;
   this.slots.push({x:a.x,y:a.y,spacing:a.spacing,cell:c.id,junction:1,seal:0,mucus:.12});
  });
  for(const [type,n] of [['fibroblast',20],['macrophage',12],['neutrophil',10],['nk',8]]){
   for(let i=0;i<n;i++){
    const reserve=type==='neutrophil'&&i>=4;
    let x=0,y=0;
    if(reserve){x=.15+(i-4)*.14;y=.918;}
    else{
     let best=-1;
     for(let k=0;k<45;k++){
      const px=this.rng.range(.06,.94),py=this.rng.range(surface(px)+.075,.868);
      let gap=Infinity;for(const c of this.cells.filter(c=>!isEpi(c)))gap=Math.min(gap,dist({x:px,y:py},c));
      if(gap>best){best=gap;x=px;y=py;}if(gap>.077)break;
     }
    }
    const c=this.create(type,x,y);c.reserve=reserve;c.z=this.rng.range(.10,.38);
   }
  }
  if(this.cells.length!==100||gob!==8)throw new Error('Initial population must be 100.');
  this.log('A quiet neighborhood. 94 tissue residents and 6 vascular reserves.','start');
 }
 create(type,x,y){const c={id:this.cells.length,type,x,y,z:0,slot:null,health:100,energy:1,alive:true,reserve:false,
  corpse:false,deathTick:null,deathKind:null,targetMarked:false,action:isEpi({type})?'maintain':'rest',source:'Initial state',
  observation:null,menu:null,weights:null,confidence:null,effect:'No decision yet.',lastDecisionTick:null,cooldown:0};this.cells.push(c);return c;}
 log(text,kind='action',cell=null){this.events.unshift({tick:this.tick,text,kind,cell});if(this.events.length>120)this.events.length=120;}
 nearestSlot(x,y=surface(x)){
  let idx=0,best=Infinity;for(let i=0;i<this.slots.length;i++){const s=this.slots[i],d=Math.hypot(x-s.x,y-s.y);if(d<best){best=d;idx=i;}}return idx;
 }
 integrity(i){const s=this.slots[i],c=this.cells[s.cell];return c.alive?s.junction:s.seal;}
 localBarrier(x,y){return this.integrity(this.nearestSlot(x,y));}
 permeability(x,y){return .002+.85*(1-this.localBarrier(x,y))**2;}
 setCommunication(on){this.communication=!!on;this.revision++;this.interventions.push({tick:this.tick,kind:'communication',on:!!on});this.log(on?'Chemical communication restored.':'New chemokine and cytokine secretion disabled. Existing signals still decay.','setting');this.recordFrame(true);}
 inject(kind,x=.25,strength=.8){
  if(!['pathogen','flare','tear','particle','resolve'].includes(kind))throw new Error('Unsupported intervention.');
  if(!Number.isFinite(x)||!Number.isFinite(strength))throw new Error('Invalid intervention position or strength.');
  x=clamp(x,.055,.945);strength=clamp(strength,.1,1);const y=surface(x);
  this.interventions.push({tick:this.tick,kind,x,strength});this.revision++;
  if(kind==='resolve'){
   this.sources=[];this.log('External triggers removed. Existing pathogen, signals and damage remain.','resolve');
  }else if(kind==='pathogen'){
   splatLuminal(this.fields.pathogen,x,y-.047,.9*strength,.033);normalizeField(this.fields.pathogen);
   this.sources.push({kind,x,y:y-.046,strength,until:this.tick+18,started:this.tick});
   this.log('Pathogen placed on the luminal side. The intact barrier limits entry.','pathogen');
  }else if(kind==='tear'){
   const ids=this.slots.map((s,i)=>({i,d:Math.abs(s.x-x)})).sort((a,b)=>a.d-b.d).slice(0,strength>.6?2:1);
   for(const {i} of ids){const s=this.slots[i];s.junction=0;s.seal=0;this.kill(this.cells[s.cell],'lysis');}
   splat(this.fields.danger,x,y+.015,.75*strength,.05);normalizeField(this.fields.danger);
   this.log('A sterile breach opened. Permeability increased locally; no pathogen was created.','tear');
  }else if(kind==='flare'){
   this.sources.push({kind,x,y:y+.07,strength,until:this.tick+60,started:this.tick});
   splat(this.fields.cytokine,x,y+.07,.65*strength,.09);splat(this.fields.danger,x,y,.24*strength,.08);
   for(const s of this.slots)if(Math.abs(s.x-x)<.16)s.junction=clamp(s.junction-.3*strength);
   normalizeField(this.fields.cytokine);normalizeField(this.fields.danger);
   this.log('Persistent inflammation and junction fragility added. This is a game analogy, not a Crohn disease model.','flare');
  }else{
   this.sources.push({kind,x,y:y+.008,strength,until:null,started:this.tick});
   splat(this.fields.danger,x,y,.55*strength,.035);normalizeField(this.fields.danger);
   this.log('A persistent particle is irritating this spot under an explicit game rule. No toxicity prediction.','particle');
  }
  this.summarize();this.recordFrame(true);
 }
 kill(c,kind='apoptosis'){
  if(!c.alive)return;c.alive=false;c.corpse=true;c.health=0;c.deathKind=kind;c.deathTick=this.tick;
  if(c.slot!==null){this.slots[c.slot].junction=0;this.slots[c.slot].seal=0;}
  this.log(`${TYPES[c.type].name} #${c.id} ${kind==='lysis'?'was lost at the breach':'left the active tissue'}.`,kind,c.id);
 }
 observe(c){
  const f=this.fields,loc={pathogen:sample(f.pathogen,c.x,c.y),danger:sample(f.danger,c.x,c.y),chemokine:sample(f.chemokine,c.x,c.y),cytokine:sample(f.cytokine,c.x,c.y)};
  // Epithelial cells sense contact across their own apical membrane, not distant tissue.
  if(isEpi(c))loc.pathogen=Math.max(loc.pathogen,sample(f.pathogen,c.x,c.y-.035));
  const ns=this.cells.filter(n=>n.id!==c.id&&!n.reserve&&dist(n,c)<ACTIVATION_POLICY.neighborRadius).sort((a,b)=>dist(a,c)-dist(b,c));
  const stressed=ns.find(n=>n.alive&&(n.health<ACTIVATION_POLICY.health||n.targetMarked));
  const target=ns.find(n=>n.alive&&isEpi(n)&&n.targetMarked&&n.health<50);
  const corpse=ns.find(n=>!n.alive&&n.corpse);
  const nearbySlots=this.slots.map((s,i)=>({i,d:Math.hypot(c.x-s.x,c.y-s.y)})).filter(v=>v.d<ACTIVATION_POLICY.repairRadius);
  const repairSlots=nearbySlots.filter(v=>this.integrity(v.i)<.92).map(v=>v.i);
  const gradient=this.gradient(c.x,c.y);
  return {id:c.id,type:c.type,health:c.health,energy:c.energy,reserve:c.reserve,x:c.x,y:c.y,
   ...loc,nearbyStressedCell:!!stressed,stressedNeighborId:stressed?.id??null,
   neighbors:[...(stressed?[stressed]:[]),...ns.filter(n=>n.alive&&n!==stressed)].slice(0,3).map(n=>({type:n.type,health:bin(1-n.health/100),status:n.targetMarked?'marked stress':'unmarked'})),
   deadNeighbors:ns.filter(n=>n.corpse).length,corpseId:corpse?.id??null,targetId:target?.id??null,
   repairSlots,junction:c.slot!==null?this.slots[c.slot].junction:null,mucus:c.slot!==null?this.slots[c.slot].mucus:null,
   nearbyGap:repairSlots.length>0,gradient,signalGradient:Math.hypot(gradient.x,gradient.y),cooldown:c.cooldown};
 }
 gradient(x,y){const f=this.fields.chemokine,d=.018;return {x:sample(f,x+d,y)-sample(f,x-d,y),y:sample(f,x,y+d)-sample(f,x,y-d)};}
 menuFor(c,o=this.observe(c)){
  if(!c.alive)return {};
  if(c.reserve)return {rest:null,enter:o.chemokine>.0025?null:'No chemokine detected at this vessel position.'};
  const m=Object.fromEntries(MENUS[c.type].map(a=>[a,null]));
  const threat=o.pathogen>.055||o.danger>.075;
  const activated=threat||o.cytokine>.22;
  const block=(a,reason)=>{if(a in m)m[a]=reason;};
  if(!threat){block('alarm','No local pathogen contact or damage signal.');block('recruit','No local alarm requiring help.');}
  if(!activated||o.cooldown>0)block('cytokine',o.cooldown>0?'Secretion is on cooldown.':'No local activation cue.');
  if(!this.communication){for(const a of ['alarm','recruit','cytokine'])block(a,'Chemical communication is disabled.');}
  if(o.pathogen<.045)block('phagocytose','No pathogen within reach.');
  if(o.corpseId===null)block('debris','No debris within reach.');
  if(o.targetId===null)block('attack','No marked stressed target within reach.');
  if(!o.nearbyGap&&o.danger<.04&&o.health>=98){block('repair','No local damage that needs repair.');block('matrix','No local gap or damaged junction.');}
  if(o.signalGradient<.00018)block('migrate','No local chemokine gradient to follow.');
  if(o.health>28)block('apoptosis','Damage is below the game threshold.');
  if(o.energy<.16){for(const a of Object.keys(m))if(['cytokine','attack','phagocytose','matrix','recruit'].includes(a))block(a,'Insufficient energy this cycle.');}
  if(o.health<=12&&'apoptosis'in m){for(const a in m)m[a]=a==='apoptosis'?null:'Critical damage leaves only apoptosis.';}
  return m;
 }
 plan(){
  const cells=this.cells.filter(c=>c.alive).map(c=>{const observation=this.observe(c),menu=this.menuFor(c,observation),legal=Object.keys(menu).filter(a=>menu[a]===null);
   if(!legal.length)throw new Error('Empty action menu.');
   const activation=activationFor(c,observation);
   return {id:c.id,type:c.type,observation,menu,legal,active:activation.active,activation};
  });
  return {tick:this.tick,revision:this.revision,cells};
 }
 localChoice(p,rng){
  const o=p.observation,w=Object.fromEntries(p.legal.map(a=>[a,.01]));
  const set=(a,v)=>{if(a in w)w[a]=Math.max(.0001,v);};
  set('maintain',1);set('rest',.5);set('patrol',.7);set('reinforce',.2+(1-(o.junction??1))*5+o.pathogen);
  set('mucus',.4+o.pathogen*5);set('alarm',o.pathogen*3+o.danger*2);set('recruit',o.pathogen*3+o.danger*2);
  set('cytokine',.1+o.pathogen*1.5+o.danger*.4);set('apoptosis',o.health<=12?10:3);
  set('phagocytose',.6+o.pathogen*16);set('debris',2.5);set('migrate',.5+o.chemokine*3+o.signalGradient*100);
  set('repair',1.8+o.danger*2);set('matrix',2.2);set('attack',2.6);set('enter',5);
  const sum=Object.values(w).reduce((a,b)=>a+b,0);for(const a in w)w[a]/=sum;
  let q=rng.next(),action=p.legal.at(-1);for(const a in w){q-=w[a];if(q<=0){action=a;break;}}
  return {action,weights:w,source:'Local policy',confidence:null};
 }
 fixedChoice(p){
  const def=p.legal.includes('maintain')?'maintain':p.legal.includes('rest')?'rest':p.legal.includes('patrol')?'patrol':p.legal[0];
  return {action:def,weights:null,source:p.legal.length===1?'Legal constraint':'Quiet cell rule',confidence:null};
 }
 step(){const p=this.plan();return this.commit(p,{},'local');}
 commit(plan,remote={},mode='local',meta={}){
  if(plan.tick!==this.tick||plan.revision!==this.revision)throw new Error('Stale round rejected.');
  const trial=new RNG(this.rng.state),selected={};
  // Entire decision set is validated before the RNG or world is changed.
  for(const p of plan.cells){
   let d;
   if(p.legal.length===1||!p.active)d=this.fixedChoice(p);
   else if(mode==='local')d=this.localChoice(p,trial);
   else{
    d=remote[p.id];if(!d)throw new Error(`Missing decision for cell ${p.id}.`);
    validateDecision(p,d);d={...d,source:'Jev',weights:d.weights,confidence:d.confidence??null};
   }
   if(!p.legal.includes(d.action))throw new Error(`Illegal action for cell ${p.id}.`);
   selected[p.id]=d;
  }
  this.rng.state=trial.state;
  const deltas={pathogen:fg(),danger:fg(),chemokine:fg(),cytokine:fg()};
  const health=new Float64Array(100),junction=new Float64Array(50),seal=new Float64Array(50),mucus=new Float64Array(50);
  const deaths=[],clearCorpses=new Set(),moves=new Map();let active=0;
  const emit=(f,c,amount,r=.05)=>splat(deltas[f],c.x,c.y,amount,r);
  const chooseMove=(c,o,follow)=>{
   let dx,dy;
   if(follow){const n=Math.hypot(o.gradient.x,o.gradient.y);dx=o.gradient.x/(n||1)*.036;dy=o.gradient.y/(n||1)*.045;}
   else {dx=this.rng.range(-.012,.012);dy=this.rng.range(-.018,.018);}
   const nx=clamp(c.x+dx,.045,.955);moves.set(c.id,{x:nx,y:clamp(c.y+dy,surface(nx)+.05,.905)});
  };
  for(const p of plan.cells){
   const c=this.cells[p.id],d=selected[p.id],o=p.observation,a=d.action;
   c.observation=deepCopy(o);c.activation=deepCopy(p.activation);c.menu={...p.menu};c.weights=d.weights?{...d.weights}:null;c.confidence=d.confidence;
   c.action=a;c.source=d.source;c.lastDecisionTick=this.tick+1;c.effect='No physical change.';
   if(p.active)active++;
   let effect='';
   switch(a){
    case 'maintain':junction[c.slot]+=.008;health[c.id]+=.25;effect='Maintained this junction.';break;
    case 'reinforce':junction[c.slot]+=.09;health[c.id]+=1.5;effect='Strengthened this junction.';break;
    case 'mucus':mucus[c.slot]+=.14;effect='Mucus increased at this cell.';break;
    case 'alarm':emit('danger',c,.018);emit('chemokine',c,.15,.083);effect='Released a local alarm and chemokine.';break;
    case 'recruit':emit('chemokine',c,.22,.085);effect='Added chemokine for nearby cells to sense.';break;
    case 'cytokine':emit('cytokine',c,.10,.055);c.cooldown=3;effect='Released a local inflammatory signal.';break;
    case 'phagocytose':emit('pathogen',c,-.27,.045);effect='Reduced pathogen within reach.';break;
    case 'debris':if(o.corpseId!==null){clearCorpses.add(o.corpseId);emit('danger',c,-.13,.06);effect=`Cleared debris from cell #${o.corpseId}.`;}break;
    case 'repair':
     for(const n of this.cells)if(n.alive&&!n.reserve&&dist(n,c)<.14)health[n.id]+=2;
     for(const i of o.repairSlots){if(this.cells[this.slots[i].cell].alive)junction[i]+=.045;else seal[i]+=.027;}
     emit('danger',c,-.08,.065);emit('cytokine',c,-.05,.065);effect='Applied repair factors locally. No cells were replaced.';break;
    case 'matrix':for(const i of o.repairSlots){if(this.cells[this.slots[i].cell].alive)junction[i]+=.06;else seal[i]+=.07;}
     emit('danger',c,-.09,.075);effect='Added persistent repair material to nearby weak spots.';break;
    case 'attack':if(o.targetId!==null){health[o.targetId]-=35;effect=`Applied damage to marked target #${o.targetId}.`;}break;
    case 'apoptosis':deaths.push(c.id);effect='Left the active tissue. The gap remains until it is sealed.';break;
    case 'migrate':chooseMove(c,o,true);effect='Moved along the local chemokine gradient.';break;
    case 'patrol':chooseMove(c,o,false);effect='Patrolled a short distance within the tissue.';break;
    case 'enter':c.reserve=false;moves.set(c.id,{x:c.x,y:.886});effect='Entered from the existing vascular reserve.';this.log(`Neutrophil #${c.id} entered the tissue from the vessel.`,'entry',c.id);break;
    case 'rest':effect='Conserved energy.';break;
   }
   c.effect=effect||'No valid effect was available.';
   c.energy=clamp(c.energy+(['rest','maintain','patrol'].includes(a)?.07:-.035),.05,1);
   if(!['rest','maintain','patrol','migrate'].includes(a))this.log(`${TYPES[c.type].name} #${c.id}: ${ACTIONS[a].label.toLowerCase()}. ${c.effect}`,'action',c.id);
  }
  // Aggregate simultaneous effects, then enforce world constraints.
  for(const c of this.cells){if(c.alive){c.health=clamp(c.health+health[c.id],0,100);if(c.cooldown>0)c.cooldown--;}if(clearCorpses.has(c.id))c.corpse=false;}
  for(let i=0;i<50;i++){const s=this.slots[i];s.junction=clamp(s.junction+junction[i]);s.seal=clamp(s.seal+seal[i],0,.88);s.mucus=clamp(s.mucus*.965+mucus[i]);}
  for(const id of deaths)this.kill(this.cells[id]);
  for(const [id,m] of moves)Object.assign(this.cells[id],m);
  this.resolveCollisions();
  for(const [name,f] of Object.entries(this.fields)){for(let i=0;i<f.length;i++)f[i]=clamp(f[i]+deltas[name][i]);}
  this.applySources();this.diffuseAll();this.applyDamage();
  this.tick++;this.revision++;this.totalDecisions+=plan.cells.length;this.apiCalls+=meta.calls||0;this.apiTokens+=meta.inputTokens||0;
  this.metrics.active=active;this.summarize();
  this.records.push({tick:this.tick,provider:mode,model:meta.model??null,usage:meta.usage??null,calls:meta.calls||0,providerMeta:deepCopy(meta),
   decisions:plan.cells.map(p=>({id:p.id,observation:p.observation,activation:deepCopy(p.activation),legal:p.legal,blocked:p.menu,...selected[p.id],effect:this.cells[p.id].effect}))});
  // Bounded logs for long running browser sessions; counts remain cumulative.
  if(this.records.length>600)this.records.shift();this.recordFrame();return selected;
 }
 applySources(){
  this.sources=this.sources.filter(s=>s.until===null||s.until>this.tick);
  for(const s of this.sources){
   if(s.kind==='pathogen')splatLuminal(this.fields.pathogen,s.x,s.y,.16*s.strength,.035);
   if(s.kind==='particle')splat(this.fields.danger,s.x,s.y,.075*s.strength,.043);
   if(s.kind==='flare'){
    splat(this.fields.cytokine,s.x,s.y,.07*s.strength,.095);splat(this.fields.danger,s.x,s.y-.03,.025*s.strength,.08);
    for(const sl of this.slots)if(Math.abs(sl.x-s.x)<.12)sl.junction=clamp(sl.junction-.023*s.strength);
   }
  }
  for(const f of Object.values(this.fields))normalizeField(f);
 }
 diffuseField(f,D,decay,barrier=false,substeps=5){
  let a=f.slice();
  const mask=new Uint8Array(a.length);
  if(barrier)for(let y=0;y<GRID.h;y++)for(let x=0;x<GRID.w;x++)mask[ix(x,y)]=+(y/(GRID.h-1)<surface(x/(GRID.w-1)));
  for(let step=0;step<substeps;step++){
   const b=a.slice();
   const exchange=(i,j,x,y)=>{
    const p=barrier&&mask[i]!==mask[j]?this.permeability(x,y):1;
    const flow=D*p*(a[j]-a[i]);b[i]+=flow;b[j]-=flow;
   };
   for(let y=0;y<GRID.h;y++)for(let x=0;x<GRID.w;x++){
    const i=ix(x,y);
    if(x<GRID.w-1)exchange(i,i+1,(x+.5)/(GRID.w-1),y/(GRID.h-1));
    if(y<GRID.h-1)exchange(i,i+GRID.w,x/(GRID.w-1),(y+.5)/(GRID.h-1));
   }
   for(let i=0;i<b.length;i++)b[i]=clamp(b[i]*(1-decay/substeps));a=b;
  }
  return a;
 }
 diffuseAll(){
  this.fields.pathogen=this.diffuseField(this.fields.pathogen,.145,.022,true);
  this.fields.danger=this.diffuseField(this.fields.danger,.14,.13);
  this.fields.chemokine=this.diffuseField(this.fields.chemokine,.22,.035,false,18);
  this.fields.cytokine=this.diffuseField(this.fields.cytokine,.15,.11);
  // Mucus acts only near its secreting surface location.
  for(const s of this.slots)if(s.mucus>.01)splat(this.fields.pathogen,s.x,s.y-.028,-s.mucus*.045,.022);
  normalizeField(this.fields.pathogen);
 }
 applyDamage(){
  for(const c of this.cells){
   if(!c.alive||c.reserve)continue;
   const o=this.observe(c),m=c.slot!==null?this.slots[c.slot].mucus:0;
   const exposure=Math.max(0,o.pathogen-.08)*(1-.65*m),inflammation=Math.max(0,o.cytokine-.25);
   const loss=exposure*(isEpi(c)?7:2.5)+inflammation*2.4;
   c.health=clamp(c.health-loss+(loss<.08?.4:0),0,100);
   if(c.slot!==null){const s=this.slots[c.slot];s.junction=clamp(s.junction-exposure*.032-inflammation*.018);}
   c.targetMarked=isEpi(c)&&c.health<45&&o.danger>.035; // Explicit toy marker, not a receptor model.
   if(c.health<=0)this.kill(c,'lysis');
  }
 }
 resolveCollisions(){
  const mobile=this.cells.filter(c=>c.alive&&!isEpi(c)&&!c.reserve);
  for(let iter=0;iter<5;iter++)for(let i=0;i<mobile.length;i++)for(let j=i+1;j<mobile.length;j++){
   const a=mobile[i],b=mobile[j],dx=(b.x-a.x)*16,dy=(b.y-a.y)*10,d=Math.hypot(dx,dy),radius={macrophage:.33,neutrophil:.245,nk:.29,fibroblast:.32},min=radius[a.type]+radius[b.type];
   if(d<min){const ux=d>1e-8?dx/d:1,uy=d>1e-8?dy/d:0,p=(min-d)*.5;
    const immA=a.type==='fibroblast',immB=b.type==='fibroblast';
    if(!immA){const w=immB?2:1;a.x-=ux*p*w/16;a.y-=uy*p*w/10;}if(!immB){const w=immA?2:1;b.x+=ux*p*w/16;b.y+=uy*p*w/10;}
   }
  }
  for(const c of mobile){c.x=clamp(c.x,.04,.96);c.y=clamp(c.y,surface(c.x)+.045,.917);}
 }
 summarize(){
  const alive=this.cells.filter(c=>c.alive),mean=f=>f.reduce((a,b)=>a+b,0)/f.length;
  let tissuePath=0;for(let y=0;y<GRID.h;y++)for(let x=0;x<GRID.w;x++)if(y/(GRID.h-1)>=surface(x/(GRID.w-1)))tissuePath+=this.fields.pathogen[ix(x,y)];
  this.metrics={...this.metrics,alive:alive.length,inTissue:alive.filter(c=>!c.reserve).length,reserve:alive.filter(c=>c.reserve).length,
   barrier:this.slots.reduce((sum,s,i)=>sum+this.integrity(i),0)/50,
   inflammation:mean(this.fields.cytokine),chemokine:mean(this.fields.chemokine),danger:mean(this.fields.danger),
   pathogen:mean(this.fields.pathogen),tissuePathogen:tissuePath,
   gaps:this.slots.filter(s=>!this.cells[s.cell].alive&&s.seal<.8).length,
   dead:100-alive.length,byType:Object.fromEntries(Object.keys(TYPES).map(t=>[t,alive.filter(c=>c.type===t).length]))};
 }
 recordFrame(replace=false){
  const plan=this.plan(),sensing=new Map(plan.cells.map(p=>[p.id,deepCopy({observation:p.observation,menu:p.menu,legal:p.legal,activation:p.activation})]));
  const active=plan.cells.filter(p=>p.active);
  this.metrics.active=active.length;
  if(!this.firstDeparture&&active.length)this.firstDeparture={tick:this.tick,cells:active.map(p=>({id:p.id,x:this.cells[p.id].x,reasons:deepCopy(p.activation.reasons)}))};
  const frame={tick:this.tick,revision:this.revision,firstDeparture:deepCopy(this.firstDeparture??null),metrics:{...this.metrics},cells:this.cells.map(c=>({id:c.id,type:c.type,x:c.x,y:c.y,z:c.z,slot:c.slot,alive:c.alive,health:c.health,reserve:c.reserve,deathTick:c.deathTick,deathKind:c.deathKind,action:c.action,source:c.source,effect:c.effect,observation:c.observation,activation:deepCopy(c.activation??null),sensing:sensing.get(c.id)??null,menu:c.menu,weights:c.weights,confidence:c.confidence,lastDecisionTick:c.lastDecisionTick,corpse:c.corpse})),
   slots:deepCopy(this.slots),fields:Object.fromEntries(Object.entries(this.fields).map(([k,f])=>[k,Array.from(f,v=>Math.round(v*10000)/10000)])),sources:deepCopy(this.sources)};
  if(replace&&this.history.at(-1)?.tick===this.tick)this.history[this.history.length-1]=frame;else this.history.push(frame);
  if(this.history.length>121)this.history.shift();
 }
 export(){return {application:'Cellville 3D',version:VERSION,seed:this.seed,tick:this.tick,interpretation:'Illustrative game rules. Not a biological predictor.',
  retainedRounds:this.records.length,retainedFrames:this.history.length,logsTruncated:this.tick>600,
  config:{initialCells:100,types:TYPES,grid:GRID,communication:this.communication,activationPolicy:ACTIVATION_POLICY},firstDeparture:deepCopy(this.firstDeparture??null),interventions:this.interventions,
  counters:{decisions:this.totalDecisions,apiCalls:this.apiCalls,inputTokens:this.apiTokens},rngState:this.rng.state,metrics:this.metrics,
  providerRequests:this.providerRequests,records:this.records,events:this.events,frames:this.history};}
}
export function validateDecision(p,d){
 if(!d||typeof d!=='object'||!p.legal.includes(d.action))throw new Error(`Illegal decision for cell ${p.id}.`);
 const w=d.weights;if(!w||typeof w!=='object'||Array.isArray(w))throw new Error('Missing probability distribution.');
 const keys=Object.keys(w);if(keys.length!==p.legal.length||keys.some(a=>!p.legal.includes(a)))throw new Error('Probability menu mismatch.');
 if(keys.some(k=>!Number.isFinite(w[k])||w[k]<0||w[k]>1))throw new Error('Invalid probabilities.');
 const sum=Object.values(w).reduce((a,b)=>a+b,0);if(Math.abs(sum-1)>.02)throw new Error('Probabilities do not sum to one.');
 if(d.confidence!==null&&d.confidence!==undefined&&(!Number.isFinite(d.confidence)||d.confidence<0||d.confidence>1))throw new Error('Invalid confidence.');
 if(w[d.action]+1e-6<Math.max(...Object.values(w)))throw new Error('Choice is inconsistent with its probabilities.');
}
export function parsePrompt(text){
 const t=text.toLowerCase().trim();
 let kind=null;
 if(/remove|resolve|stop the|withdraw/.test(t))kind='resolve';
 else if(/microplastic|particle/.test(t))kind='particle';
 else if(/crohn|ibd|colitis|flare|persistent inflammation/.test(t))kind='flare';
 else if(/pathogen|bacter|salmonella|infection/.test(t))kind='pathogen';
 else if(/tear|rupture|breach|scratch/.test(t))kind='tear';
 if(!kind)return {valid:false,error:'This prototype understands pathogen, persistent inflammation, sterile tear, persistent particle, and remove triggers. Choose one, or use a matching example.'};
 const x=/right/.test(t)?.76:/center|centre|middle/.test(t)?.5:.25;
 const strength=/mild|small|gentle/.test(t)?.45:/massive|severe|strong/.test(t)?1:.8;
 const multiple=(/pathogen|bacter/.test(t)&&/tear|rupture|breach/.test(t));
 return {valid:true,kind,x,strength,description:{pathogen:'Add a luminal pathogen source for 18 cycles.',flare:'Weaken local junctions and add inflammatory input for 60 cycles.',tear:'Remove one or two epithelial cells. Create danger, not pathogen.',particle:'Add a persistent local irritation source until triggers are removed.',resolve:'Remove external sources. Existing signals and damage will not disappear instantly.'}[kind],
  note:multiple?'Only pathogen arrival is planned. Apply a sterile tear separately to test a combined event.':kind==='flare'?'An illustration of persistent inflammation, not a disease model.':kind==='particle'?'Irritation is a game assumption, not a toxicity prediction.':'The cells will sense local cues, not this prompt.'};
}
