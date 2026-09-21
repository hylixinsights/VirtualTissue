import {CompartmentFields} from './manual-fields.mjs';
import {IleumTissue} from './ileum-host.mjs';
import {RuleKernel,readPath,writePath,evaluatePredicate,exactMemory,receptorActivity} from '../manual_v3/kernel.mjs';
import {isEpi,surface,clamp,GRID} from './engine.mjs';
import {ILEUM_MANIFEST} from './ileum-parameters.mjs';
import {ACTIVE_PACK,ACTIVE_REGISTRY,validatePack} from './tissue-pack.mjs';
const registry=ACTIVE_REGISTRY;

const copy=v=>JSON.parse(JSON.stringify(v));
const assert=(v,m)=>{if(!v)throw new Error(m);};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const alive=c=>c.alive&&['viable','injured'].includes(c.state.viability);
export const HOST_ACTIONS=Object.freeze(ACTIVE_PACK.manual.supported_actions);
export const V5_RULES=Object.freeze({version:'cellville.unified.5.0.0',manual_version:registry.metadata.version,decision_interval_min:5,contact_radius:.05,neighbor_radius:.08,structural_radius:.09,local_field_threshold:.00001,patch_radius:.09,PAMP_leak_rate:.05,DAMP_release_rate:.02,cue_receptor_K:.005,memory_tau_min:20,manual_handlers:HOST_ACTIONS,population:{resident_macrophage:6,inflammatory_monocyte:4,dendritic:2,reserve_monocytes:2,reserve_neutrophils:6},CCL2_output_rate:.03,dendritic_sampling_depth:.04,corpse_persistence:'until efferocytosis; no unimplemented extrusion',evidence:'P: declared host priors, not measured parameters. Original manual predicates, costs, durations and continuation remain authoritative.'});
export const actionLabel=id=>id==='WAIT'?'Keep observing':registry.actions.find(a=>a.id===id)?.label??id;
export function parsePerturbation(text){
 const t=text.toLowerCase().trim().replace(/\b(no|without)\s+(?:a\s+)?(?:pathogen|bacteria|epec|etec|inflammation|ibd)\b/g,''),x=/right/.test(t)?.76:/center|centre/.test(t)?.5:.25;
 if(!t)return {valid:false,error:'Describe what enters or changes in the tissue.'};
 if(/salmonella|virus|viral|shiga|helmin|tumou?r|cancer/.test(t))return {valid:false,error:'That mechanism is not implemented. Available inputs: ETEC, EPEC, focal innate inflammation and barrier injury.'};
 const kinds=[];
 if(/lactose|lactase/.test(t))return {valid:false,error:'That perturbation is not supported by the active gut manual.'};
 if(/etec/.test(t))kinds.push('etec');
 if(/epec/.test(t)||(!/etec/.test(t)&&/pathogen|bacter|e\.?\s*coli|infection/.test(t)))kinds.push('epec');
 if(/ibd|crohn|ileitis|inflamm/.test(t))kinds.push('ileitis');
 if(/scratch|tear|injury|structural damage/.test(t)&&!kinds.includes('ileitis'))kinds.push('injury');
 if(!kinds.length&&/restore|resolution/.test(t))kinds.push('regulation');
 if(/^(please )?(stop|remove|withdraw)/.test(t))kinds.splice(0,kinds.length,'resolve');
 if(!kinds.length)return {valid:false,error:'Use a positive, explicit input: ETEC enters on the left; EPEC enters on the right; or focal IBD-like inflammation. CXCL8 is a cellular consequence, not a prompt input.'};
 const descriptions={etec:'24 ETEC bacteria enter locally. Colonization releases LT/ST; enterocytes can respond with ion and water secretion.',epec:'24 EPEC bacteria enter locally. Attaching-and-effacing injury requires contact.',ileitis:'A focal barrier lesion with impaired resolution; an innate challenge, not the full IBD disease.',injury:'A focal barrier injury. No cytokine is injected.',regulation:'Restore local resolution competence.',resolve:'Stop future bacterial replication; existing inputs remain.'};
 return {valid:true,kinds,x,title:kinds.map(k=>k.toUpperCase()).join(' + '),description:kinds.map(k=>descriptions[k]).join(' ')};
}
class LocalFields extends CompartmentFields {
 constructor(){super();for(const k of ['PAMP','DAMP','CCL2','LT','ST']){this.values[k]=new Float64Array(this.w*this.h);this.ledger[k]={deposited:0,decayed:0,initial:0};}}
 deposit(field,index,amount){if(!['PAMP','DAMP','CCL2','LT','ST'].includes(field))return super.deposit(field,index,amount);assert(this.side[index]===(['LT','ST'].includes(field)?'apical':'basal')&&Number.isFinite(amount)&&amount>=0,'Invalid local cue deposition.');this.values[field][index]+=amount/this.volume;this.ledger[field].deposited+=amount;}
 display(){const base=Object.create(this);base.values=Object.fromEntries(Object.entries(this.values).filter(([k])=>!['PAMP','DAMP','CCL2','LT','ST'].includes(k)));const result=CompartmentFields.prototype.display.call(base);result.CCL2=Array.from({length:GRID.w*GRID.h},(_,i)=>{const x=(i%GRID.w)/(GRID.w-1),y=Math.floor(i/GRID.w)/(GRID.h-1);if(y<surface(x))return 0;const j=Math.min(this.h-1,Math.floor(y*this.h))*this.w+Math.min(this.w-1,Math.floor(x*this.w));return 1-Math.exp(-this.values.CCL2[j]*30);});return result;}
}
export class UnifiedTissue extends IleumTissue {
 constructor(seed=20260919,pack=ACTIVE_PACK){
  super(seed);this.pack=validatePack(pack);this.registry=pack.registry;this.rules={...V5_RULES,...pack.definition.host_parameters};this.unifiedReady=true;this.policy='Jev_individual_cells_manual_constraints';this.mode='unified';
  this.kernel=new RuleKernel(this.registry,{seed:this.seed,capabilities:['immutable_snapshot','unique_cell_ids','atomic_commit','event_log','resource_ledger','field_transport','stores','barrier','phenotype','targets','phagocytosis','motility','contact_graph','vascular_recruitment','immune_recognition','death','antigen']});
  const rng=this.kernel.rng;this.rngDraws=0;this.kernel.rng=()=>{this.rngDraws++;return rng();};
  this.fields=new LocalFields();this.decisions=[];this.requestAudit=[];this.firstDeparture=null;this.running=false;this.lastPrompt=null;
  this.events=[];this.eventLog=[];this.history=[];this.totalDecisions=0;
  for(const c of this.cells){
   c.state.type=c.type==='macrophage'?'resident_macrophage':c.type;
   c.state.resources={energy:1,phagocytic_capacity:1};
   c.state.outputs={CXCL8:0,TNF:0,IL10:0};
   c.state.memory={alarm:0,TNF:0,stromal_alarm:0};
   c.state.programs={inflammation:0,repair:.6,phagolysosome:.7,activation:0,regulation:.6};
   c.state.competence={TNFR:1,CXCL8_output:isEpi(c)||c.type==='fibroblast',TNF_response:isEpi(c),local_secretory_stimulus:c.type==='goblet',inflammatory_stroma:c.type==='fibroblast',TNF_output:c.type==='macrophage',IL10_output:c.type==='macrophage',chemotaxis:c.type==='neutrophil',vascular_entry:c.type==='neutrophil',cytotoxicity:c.type==='nk'};
   if(c.type==='nk')c.state.stores.cytotoxic=1;
   c.substrate={...c.substrate,CXCL8:isEpi(c)||c.type==='fibroblast'?1:0,TNF:c.type==='macrophage'?12:0,IL10:c.type==='macrophage'?4:0,energy:1};
   c.basal=this.fields.nearest(c.x*300,c.y*200,'basal');
   c.nextDecisionAt=0;c.source='Steady state';c.effect='Routine maintenance; no local departure.';
   c.unified={active:false,reasons:[],last:null};
  }
  // Explicit population, no conversion of an NK or neutrophil into a myeloid cell.
  const myeloid=this.cells.filter(c=>c.type==='macrophage');
  for(const [i,c] of myeloid.entries()){
   const type=i<6?'resident_macrophage':i<10?'inflammatory_monocyte':'dendritic';
   c.state.type=type;
   if(type==='inflammatory_monocyte'){
    c.state.competence.CCL2_output=true;c.state.competence.chemotaxis=true;c.state.competence.vascular_entry=true;
    c.state.outputs.CCL2=0;c.substrate.CCL2=4;
    if(i>=8){c.reserve=true;c.lab.compartment='vascular_reservoir';c.x=i===8?.27:.74;c.y=.94;}
    else {c.x=i===6?.28:.73;c.y=surface(c.x)+.08;}
   }
   if(type==='dendritic'){
    c.x=i===10?.25:.75;c.y=surface(c.x)+.025;
    c.state.competence.TNF_output=false;c.state.competence.IL10_output=false;
    c.state.programs.antigen_processing=.7;
   }
   c.basal=this.fields.nearest(c.x*300,c.y*200,'basal');
  }
  // The pack supplies every initial cell, including its manual identity and inventories.
  const templates=new Map(this.cells.map(c=>[c.type,c])),slotTemplate=copy(this.slots[0]),patchTemplate=copy(this.lab.patches[0]);
  this.cells=pack.population.map((row,i)=>{
   const c=copy(templates.get(row.morphology));
   Object.assign(c,{id:row.id,visualIndex:i,type:row.morphology,x:row.x,y:row.y,z:row.z,reserve:row.reserve,health:row.health,alive:true,corpse:false,slot:null});
   Object.assign(c.state,{id:row.id,type:row.manual_type,viability:'viable'});
   for(const key of ['resources','stores','outputs','competence','memory','programs'])c.state[key]=copy(row[key]);
   c.substrate=copy(row.substrate);c.lab.compartment=c.reserve?'vascular_reservoir':'basal';
   c.basal=this.fields.nearest(c.x*300,c.y*200,'basal');c.apical=this.fields.nearest(c.x*300,c.y*200,'apical');
   return c;
  });
  this.cellById=new Map(this.cells.map(c=>[c.id,c]));
  this.slots=this.cells.filter(isEpi).sort((a,b)=>a.x-b.x).map((c,i)=>{c.slot=i;return {...copy(slotTemplate),x:c.x,y:c.y,cell:c.id,junction:1,seal:0};});
  this.lab.patches=this.slots.map(s=>({...copy(patchTemplate),x:s.x}));
  this.lab.etecWater=0;
  for(const c of this.cells){
   c.state.damage=0;c.state.programs.survival??=.6;c.state.competence.death_execution=true;
   c.v5={origin:c.state.type,phenotype:c.state.type,antigens:[],presented:[],transitions:[],trail:[],distance_um:0,injuryMinutes:0};
   c.physical={x_um:c.x*300,y_um:c.y*200};
  }
  this.log('One tissue. Manual constraints determine eligibility; Jev chooses separately for each activated cell.','start');
  this.recordFrame();
 }
 contact(c,b){
  if(!['free','attached'].includes(b.state)||c.reserve)return false;
  const same=isEpi(c)||b.compartment===c.lab.compartment;
  // A dendritic process can sample across the immediately adjacent epithelium.
  // It cannot reach a distant bacterium or search for a focus.
  const sampling=c.state.type==='dendritic'&&b.compartment==='apical'&&c.y-surface(c.x)<this.rules.dendritic_sampling_depth;
  return dist(c,b)<this.rules.contact_radius&&(same||sampling);
 }
 commitSenescence(c){
  if(c.state.viability==='death_committed')return;
  c.state.viability='death_committed';c.v5.transitions.push({to:'death_committed',time_min:this.time_min,source:'finite recruited neutrophil lifetime'});
  for(const e of this.kernel.activeEvents(c.id))if(this.kernel.action(e.action_id).continuation.on_death==='cancel')this.kernel.cancel(e.id,'terminal_death_precedence');
 }
 recordDeath(c,reason,event_id){
  c.alive=false;c.corpse=true;c.health=0;c.state.damage=1;c.state.viability='dead_present';c.deathTick=this.tick;c.deathKind='unclassified';
  c.v5.transitions.push({to:'dead_present',time_min:this.time_min,event_id});
  if(c.slot!==null)this.slots[c.slot].junction=0;
  for(const id of c.lab.cargo){const b=this.target(id);if(b&&!id.startsWith('corpse:')){b.state='free';b.carrier=null;b.x=c.x;b.y=c.y;b.compartment='basal';}}
  c.lab.cargo=[];this.lab.patches[this.nearestPatch(c.x)].DAMP=clamp(this.lab.patches[this.nearestPatch(c.x)].DAMP+.3);
  this.log(reason+'; corpse remains until actual clearance.','cell_death',c.id,{event_id});
 }
 local(c){
  const fi=this.fields.nearest(c.x*300,c.y*200,'basal'),tnf=this.fields.values.TNF[fi],cxcl8=this.fields.values.CXCL8[fi];
  const ai=this.fields.nearest(c.x*300,c.y*200,'apical'),LT=isEpi(c)?this.fields.values.LT[ai]:0,ST=isEpi(c)?this.fields.values.ST[ai]:0,enterotoxin=Math.max(receptorActivity(LT,this.pack.definition.etec.receptor_K,1,1),receptorActivity(ST,this.pack.definition.etec.receptor_K,1,1));
  const nearby=this.cells.filter(v=>v.id!==c.id&&!v.reserve&&dist(c,v)<this.rules.neighbor_radius);
  const patches=this.lab.patches.map((q,i)=>({...q,i,y:this.slots[i].y,junction:this.slots[i].junction})).filter(q=>dist(c,q)<this.rules.patch_radius);
  const bacteria=this.lab.bacteria.filter(b=>this.contact(c,b));
  const structural=patches.filter(q=>q.junction<.98),pamp=Math.max(receptorActivity(this.fields.values.PAMP[fi],this.rules.cue_receptor_K,1,1),...patches.map(q=>q.PAMP)),damp=Math.max(receptorActivity(this.fields.values.DAMP[fi],this.rules.cue_receptor_K,1,1),...patches.map(q=>q.DAMP));
  const cargo=this.lab.bacteria.find(b=>b.state==='internalized'&&b.carrier===c.id);
  const corpse=nearby.find(v=>v.state.viability==='dead_present'&&dist(c,v)<this.rules.contact_radius&&v.lab.compartment===c.lab.compartment);
  const changes=nearby.filter(v=>v.health<94||v.state.viability==='dead_present'||Object.values(v.state.outputs).some(n=>n>.1));
  const reasons=[];if(enterotoxin>.01)reasons.push('Local enterotoxin');
  if(!c.reserve){
   if(bacteria.length)reasons.push('Nearby pathogen');if(pamp>.01)reasons.push('Local microbial products');if(damp>.01)reasons.push('Local damage signal');
   if(structural.length)reasons.push('Nearby barrier injury');if(changes.length)reasons.push('Altered neighboring cell');if(c.health<94)reasons.push('Own injury');if(cargo||c.lab.cargo.length)reasons.push('Internalized cargo');
  }
  if(tnf>this.rules.local_field_threshold)reasons.push('Local TNF');if(cxcl8>this.rules.local_field_threshold)reasons.push('Local CXCL8');
  // Only adjacent field samples, never a search for a distant focus or source.
  const ccl2=this.fields.values.CCL2[fi];
  if(ccl2>this.rules.local_field_threshold&&c.state.type==='inflammatory_monocyte')reasons.push('Local CCL2');
  if(c.v5?.antigens.some(a=>!c.v5.presented.some(p=>p.id===a.id)))reasons.push('Acquired antigen');
  const adapting=c.state.type==='inflammatory_monocyte'&&!c.reserve&&c.lab.recruitedAt!==null&&c.v5?.phenotype!=='resident_like';
  if(adapting)reasons.push('Post-recruitment adaptation');
  const x=fi%this.fields.w,y=Math.floor(fi/this.fields.w),value=this.fields.values[c.state.type==='inflammatory_monocyte'?'CCL2':'CXCL8'];
  const sample=(xx,yy)=>{const j=yy*this.fields.w+xx;return xx>=0&&xx<this.fields.w&&yy>=0&&yy<this.fields.h&&this.fields.side[j]==='basal'?value[j]:value[fi];};
  const gx=(sample(x+1,y)-sample(x-1,y))/2,gy=(sample(x,y+1)-sample(x,y-1))/2,norm=Math.hypot(gx,gy);
  return {fi,tnf,cxcl8,ccl2,pamp,damp,LT,ST,enterotoxin,bacteria,cargo,corpse,structural,changes,reasons,active:alive(c)&&reasons.length>0,gradient:{x:norm?gx/norm:0,y:norm?gy/norm:0,magnitude:norm/(norm+.00001)}};
 }
 snapshot(c,event=null){
  if(!this.unifiedReady)return super.snapshot(c);
  const l=this.local(c),forced=event?.target_id&&!event.target_id.startsWith('vascular:')?this.target(event.target_id):null;
  const target=forced??l.bacteria.find(b=>!this.kernel.targetOwners.has(b.id)&&this.contact(c,b))??l.corpse;
  const valid=!!target&&dist(c,target)<this.rules.contact_radius&&target.lab?.compartment===c.lab.compartment||!!target&&!target.lab&&this.contact(c,target);
  const secretory=isEpi(c)?this.fields.values.SECRETORY_STIMULUS[c.apical]??0:0;
  return {...this.epoch(),cell:copy(c.state),signals:{enterotoxin:l.enterotoxin,LT:l.LT,ST:l.ST,TNF:l.tnf,IL10:this.lab.patches[this.nearestPatch(c.x)].IL10,CCL2:l.ccl2,OSM:0,IL1B_ACTIVE:0,alarm:Math.max(l.pamp,l.damp,receptorActivity(l.tnf,.035,1,1)),secretory_stimulus:receptorActivity(secretory,this.param('receptor_K'),this.param('hill_n'),1)},context:{species:'human',epithelial_surface:isEpi(c),apical_access:isEpi(c),basal_access:!c.reserve,compartment:c.reserve?'vascular_reservoir':c.lab.compartment,
   target_id:target?.id??null,target_kind:target?.state?.viability==='dead_present'?'corpse':target?'microbial_object':null,target_unreserved:!!target&&!this.kernel.targetOwners.has(target.id),valid_contact:!!valid,target_accessibility:valid?1:0,efferocytic_target_verified:target?.state?.viability==='dead_present',intracellular_cargo_present:c.lab.cargo.length>0,
   migration_route:!c.reserve&&c.lab.compartment==='basal',gradient_magnitude:l.gradient.magnitude,gradient:copy(l.gradient),
   adhesion_strength:receptorActivity(c.state.type==='inflammatory_monocyte'?l.ccl2:l.cxcl8,.00001,1,1),adhesion_verified:c.reserve&&(c.state.type==='inflammatory_monocyte'?l.ccl2:l.cxcl8)>this.rules.local_field_threshold,crossing_slot_available:!this.kernel.targetOwners.has(`vascular:${c.id}`),crossing_slot_id:c.id,vascular_route:c.reserve,
   adaptation_permitted:c.state.type==='inflammatory_monocyte'&&!c.reserve&&c.lab.recruitedAt!==null&&c.v5?.phenotype!=='resident_like'&&this.lab.patches[this.nearestPatch(c.x)].resolution>.5,
   intracellular_antigen_present:!!c.v5?.antigens.some(a=>!c.v5.presented.some(p=>p.id===a.id)),antigen_id:c.v5?.antigens.find(a=>!c.v5.presented.some(p=>p.id===a.id))?.id??null,
   regulatory_output_verified:c.type==='macrophage'&&this.lab.patches[this.nearestPatch(c.x)].resolution>.5,
   // EPEC attachment or generic stress is NOT verified NK target recognition.
   NK_balance_verified:false,activation_verified:false},provenance:{manual:this.registry.metadata.version,host:this.rules.version,evidence:'P'}};
 }
 candidates(c,s=this.snapshot(c)){
  if(!this.unifiedReady)return super.candidates(c,s);
  return this.registry.cell_types[c.state.type].allowed_actions.map(id=>{
   let row;try{row=this.kernel.eligibility(id,s);}catch(e){row={action_id:id,allowed:false,reasons:[e.code??e.message]};}
   if(!HOST_ACTIONS.includes(id))return {...row,allowed:false,reasons:['UNIMPLEMENTED_HOST_HANDLER',...row.reasons]};
   if(id==='EPITHELIAL_RECOVERY'&&c.health>=99&&this.slots[c.slot]?.junction>=.98&&this.lab.patches[c.slot]?.brush>=.98)return {...row,allowed:false,reasons:['NO_DEPARTURE_TO_RECOVER',...row.reasons]};
   if(c.reserve&&id!=='VASCULAR_CROSSING')return {...row,allowed:false,reasons:['CELL_IN_VASCULAR_RESERVE',...row.reasons]};
   return row;
  });
 }
 plan(){
  const entries=this.cells.filter(alive).map(c=>{const local=this.local(c),snapshot=this.snapshot(c),rows=this.candidates(c,snapshot),actions=rows.filter(r=>r.allowed).map(r=>r.action_id);
   const due=local.active&&this.time_min>=c.nextDecisionAt;
   return {id:c.id,visualIndex:c.visualIndex,local,snapshot,rows,actions:due?['WAIT',...actions]:[],eligible:due&&actions.length>0};});
  const cells=entries.filter(e=>e.eligible).map(e=>({id:e.visualIndex,type:this.cellById.get(e.id).type,actions:e.actions,observation:{manual_type:e.snapshot.cell.type,energy:e.snapshot.cell.resources.energy,health:this.cellById.get(e.id).health,LT:e.local.LT,ST:e.local.ST,enterotoxin:e.local.enterotoxin,TNF:e.local.tnf,CXCL8:e.local.cxcl8,CCL2:e.local.ccl2,damage:e.snapshot.cell.damage,antigen_count:this.cellById.get(e.id).v5.antigens.length,presented_count:this.cellById.get(e.id).v5.presented.length,recruited:this.cellById.get(e.id).lab.recruitedAt!==null,adapted:this.cellById.get(e.id).v5.phenotype==='resident_like',PAMP:e.local.pamp,DAMP:e.local.damp,nearby_pathogens:e.local.bacteria.length,nearby_altered_cells:e.local.changes.length,nearby_barrier_damage:e.local.structural.length,cargo:!!e.local.cargo,contact:!!e.snapshot.context.valid_contact,reserve:this.cellById.get(e.id).reserve,gradient:e.local.gradient.magnitude,alarm_memory:e.snapshot.cell.memory.alarm,reasons:[...e.local.reasons]}}));
  return {epoch:this.epoch(),entries,request:{...this.epoch(),contract:this.rules.version,pack_fingerprint:this.pack.fingerprint,cells}};
 }
 validateReply(plan,response){
  assert(JSON.stringify(plan.epoch)===JSON.stringify(this.epoch()),'Stale tissue snapshot. No round applied.');
  for(const k of ['run_id','tick','revision','time_min'])assert(response?.[k]===plan.epoch[k],'Jev response belongs to another tissue snapshot.');
  assert(typeof response.meta?.model==='string'&&response.meta.model.length>0,'Missing actual provider model.');
  assert(response.decisions&&Object.keys(response.decisions).length===plan.request.cells.length,'Incomplete Jev decisions.');
  for(const c of plan.request.cells){const d=response.decisions[c.id];assert(d&&d.source==='Jev'&&c.actions.includes(d.action),'Invalid cellular choice.');assert(d.weights&&Object.keys(d.weights).length===c.actions.length&&c.actions.every(a=>Number.isFinite(d.weights[a])&&d.weights[a]>=0&&d.weights[a]<=1),'Invalid Jev distribution.');assert(Math.abs(Object.values(d.weights).reduce((a,b)=>a+b,0)-1)<=1e-6,'Invalid Jev probabilities: distribution must sum to 1. No round applied.');assert(d.weights[d.action]+1e-6>=Math.max(...Object.values(d.weights)),'Choice is not the maximum probability.');assert(Number.isFinite(d.confidence)&&d.confidence>=0&&d.confidence<=1,'Invalid confidence.');}
  const current=this.plan();assert(JSON.stringify(current.request)===JSON.stringify(plan.request)&&JSON.stringify(current.entries.map(e=>e.snapshot))===JSON.stringify(plan.entries.map(e=>e.snapshot)),'Plan changed before commit.');
 }
 commitChoices(plan,response){
  this.validateReply(plan,response);
  // Every answer is validated before RNG, reservations or cell state change.
  for(const entry of plan.entries.filter(e=>e.eligible)){
   const c=this.cellById.get(entry.id),d=response.decisions[c.visualIndex];let event=null,rejection=null;
   if(d.action!=='WAIT'){
    // Shared targets are resolved in stable ID order. The losing choice is logged,
    // never replaced with another action or falsely reported as executed.
    try{event=this.kernel.start(d.action,entry.snapshot);}catch(e){rejection=e.code??e.message;}
   }
   c.nextDecisionAt=this.time_min+(event&&['NEUTROPHIL_CHEMOTAXIS','MONOCYTE_CHEMOTAXIS'].includes(event.action_id)?Math.min(this.rules.decision_interval_min,Math.ceil(event.duration_min)):this.rules.decision_interval_min);c.lastDecisionTick=this.tick;c.source='Jev';c.action=d.action;
   c.effect=rejection?'Chosen action could not reserve its target/resources.':event?'Preparing the chosen action.':'Continues observing local cues.';
   c.unified.last={...this.epoch(),action:d.action,weights:copy(d.weights),confidence:d.confidence,source:'Jev',model:response.meta?.model??'unreported',reasons:[...entry.local.reasons],event_id:event?.id??null,rejection};
   this.decisions.push({cell_id:c.id,...copy(c.unified.last)});this.totalDecisions++;
   this.log(`${actionLabel(d.action)}${event?` started; ${event.duration_min.toFixed(0)} biological min`:rejection?` not started: ${rejection}`:' selected'}.`,'cell_decision',c.id,{decision:copy(c.unified.last)});
  }
  this.recorder?.decisionRound(plan,response);
  this.providerRequests.push({kind:'individual_cell_round',...plan.epoch,cells:plan.request.cells.map(c=>c.id),meta:copy(response.meta??{})});
 }
 async advance(minutes,provider,onFrame=()=>{}){
  assert(!this.running,'A biological step is already pending.');assert(Number.isInteger(minutes)&&minutes>0&&minutes<=60,'Advance 1–60 minutes.');this.running=true;
  try{for(let i=0;i<minutes;i++){
   const plan=this.plan();
   if(plan.request.cells.length){
    assert(typeof provider==='function','Connect Jev to let activated cells choose.');
    let response;
    try{response=await provider(copy(plan.request));this.requestAudit.push({epoch:plan.epoch,status:'returned',meta:copy(response.meta??{})});this.apiCalls+=response.meta?.calls??0;this.apiTokens+=response.meta?.inputTokens??0;this.commitChoices(plan,response);}
    catch(e){this.requestAudit.push({epoch:plan.epoch,status:'failed',error:e.message,meta:copy(e.meta??{})});if(!response){this.apiCalls+=e.meta?.calls??0;this.apiTokens+=e.meta?.inputTokens??0;}throw e;}
   }
   this.advancePhysical();this.recordFrame();onFrame(this.history.at(-1));
  }}finally{this.running=false;}
 }
 step(){throw new Error('Use advance(minutes, Jev provider). No autonomous cellular decision policy is available in v5.');}
 advanceOne(){throw new Error('Use the unified Jev transaction; autonomous host-cell policy is disabled.');}
 startEvent(action,...args){assert(!this.unifiedReady||action==='ILEUM_ADHESION','Tissue-cell actions must use the manual kernel after a Jev choice.');return super.startEvent(action,...args);}
 inject(kind,x=.25,strength=1){
  if(!this.unifiedReady)return super.inject(kind,x,strength);
  assert(!this.running,'Wait for the current decision round.');
  if(kind==='etec'){
   assert(Number.isFinite(x)&&strength===1,'Use a finite position and unit input.');x=clamp(x,.055,.945);
   const n=this.pack.definition.etec.bacteria_per_input;assert(this.lab.bacteria.length+n<=ILEUM_MANIFEST.bacteria.max_agents,'Bacterial agent limit reached. Start a new experiment.');
   this.revision++;this.interventions.push({...this.epoch(),kind,x});
   const cohort=`etec-bolus-${this.interventions.length}`;this.lab.cohorts.push({id:cohort,intimateAttachment:false});
   for(let i=0;i<n;i++){const bx=clamp(x+(this.labRandom()-.5)*.10,.02,.98);this.lab.bacteria.push({id:`etec-${this.lab.nextBacterium++}`,species:'ETEC',cohort,x:bx,y:surface(bx)-.055,state:'free',compartment:'apical',slot:null,owner:null,carrier:null,attachment:false,event:null,contactMinutes:0});}
   this.lab.bacterialBalance.introduced+=n;this.log('ETEC enters locally. Colonization and LT/ST release precede constrained cellular ion transport.','intervention');
  }else if(kind==='injury'){
   assert(Number.isFinite(x),'Invalid intervention position.');x=clamp(x,.055,.945);this.revision++;
   for(const s of this.slots)if(Math.abs(s.x-x)<.06)s.junction=Math.min(s.junction,.6);
   this.interventions.push({...this.epoch(),kind,x});this.log('Focal barrier injury applied. No cytokine added.','intervention');this.recordFrame(true);
  }else super.inject(kind,x,strength);
  this.recordFrame(true);
 }
 applyPrompt(scenario){assert(scenario?.valid&&Array.isArray(scenario.kinds),'Invalid perturbation.');for(const kind of scenario.kinds)this.inject(kind,scenario.x);this.lastPrompt=copy(scenario);this.recordFrame(true);}
 updateContinuous(dt){
  const observations=new Map(this.cells.filter(alive).map(c=>[c.id,this.local(c)]));
  for(const c of this.cells.filter(alive)){
   const l=observations.get(c.id),state=c.state,tnf=receptorActivity(l.tnf,.035,1,1),alarm=c.reserve?0:Math.max(l.pamp,l.damp,tnf,l.bacteria.length?1:0);
   state.memory.alarm=exactMemory(state.memory.alarm,alarm,this.rules.memory_tau_min,dt);
   state.memory.TNF=exactMemory(state.memory.TNF,tnf,this.rules.memory_tau_min,dt);
   state.memory.stromal_alarm=exactMemory(state.memory.stromal_alarm,Math.max(tnf,l.damp),this.rules.memory_tau_min,dt);
   c.lab.activation=alarm;c.lastCXCL8Flux=0;
   const replenish=Math.min(c.substrate.energy,Math.max(0,1-state.resources.energy),this.param('resource_recovery_rate')*dt);state.resources.energy+=replenish;c.substrate.energy-=replenish;c.accounting.energy_refilled+=replenish;
   if(c.type==='goblet'){const refill=Math.min(c.substrate.granules,1-state.stores.granules,this.param('store_refill_rate')*dt);c.substrate.granules-=refill;state.stores.granules+=refill;c.accounting.granules_refilled+=refill;}
   if(c.type==='enterocyte'){
    const capacity=state.outputs.ION_WATER??0,amount=Math.min(this.lab.waterReservoir,capacity*l.enterotoxin*this.pack.definition.etec.water_per_cell_min*dt);
    this.lab.waterReservoir-=amount;this.lab.balance.waterDrawn+=amount;this.lab.etecWater+=amount;this.lab.patches[c.slot].water+=amount;
    state.outputs.ION_WATER=capacity*Math.exp(-this.param('soluble_output_decay')*dt);
   }
   for(const mediator of ['CXCL8','TNF','IL10','CCL2']){
    const capacity=state.outputs[mediator]??0,k=this.param('soluble_output_decay'),integral=capacity*(-Math.expm1(-k*dt))/k;
    const rate=mediator==='CXCL8'?this.param('output_rate'):mediator==='TNF'?ILEUM_MANIFEST.innate.tnf_rate:mediator==='CCL2'?this.rules.CCL2_output_rate:.03;
    const amount=!c.reserve&&this.kernel.environment({cell:state}).cell.resources.energy>=this.param('resource_gate')?Math.min(c.substrate[mediator]??0,rate*integral):0;
    if(amount>0){if(mediator==='IL10')this.lab.patches[this.nearestPatch(c.x)].IL10+=amount;else this.fields.deposit(mediator,l.fi,amount);c.substrate[mediator]-=amount;if(mediator==='CXCL8'){c.lastCXCL8Flux=amount/dt;c.accounting.CXCL8_emitted+=amount;}if(mediator==='TNF')c.lab.secretedTNF+=amount;}
    state.outputs[mediator]=capacity*Math.exp(-k*dt);
   }
  }
 }
 commitCompletion(plan){
  assert(plan.run_id===this.run_id,'Wrong completion run.');
  const key=`${this.run_id}:${plan.transaction_id}`,prior=this.appliedTransactions.get(key);
  if(prior){assert(JSON.stringify(prior.plan)===JSON.stringify(plan),'Modified completion retry.');return copy(prior.receipt);}
  const canonical={...this.kernel.completionPlan(plan.event_id),run_id:this.run_id};assert(JSON.stringify(canonical)===JSON.stringify(plan),'Modified completion payload.');
  const e=this.kernel.getEvent(plan.event_id),c=this.cellById.get(e.cell_id),a=this.kernel.action(e.action_id);
  assert(HOST_ACTIONS.includes(a.id)&&this.time_min>=plan.ready_at,'Unsupported or premature completion.');
  assert(evaluatePredicate(a.continuation.recheck_predicate,this.kernel.environment(this.snapshot(c,e),e.id),this.registry),'Physical continuation failed.');
  const state=copy(c.state);for(const cost of plan.reserved_costs){const n=readPath({cell:state},cost.path);assert(Number.isFinite(n)&&n>=cost.amount,'Inventory lost.');writePath({cell:state},cost.path,n-cost.amount);}
  const target=plan.target_id?this.target(plan.target_id):null,ops=[];
  for(const effect of plan.effects){
   if(effect.op==='set'){assert(['cell.outputs.ION_WATER','cell.outputs.CXCL8','cell.outputs.TNF','cell.outputs.IL10','cell.outputs.CCL2','cell.programs.inflammation','cell.viability'].includes(effect.path),'Unsupported output.');writePath({cell:state},effect.path,effect.value);continue;}
   switch(effect.kind){
    case 'stored_release':{const n=plan.reserved_costs.find(v=>v.path==='cell.stores.granules')?.amount;assert(c.access.apical&&Number.isFinite(n),'Invalid mucus release.');ops.push(()=>{this.fields.deposit('MUCUS',c.apical,n);c.accounting.granules_emitted+=n;});break;}
    case 'junction_remodel':assert(isEpi(c),'Invalid junction actor.');ops.push(()=>this.slots[c.slot].junction=clamp(this.slots[c.slot].junction-this.param('state_change_amount')));break;
    case 'phenotype_relaxation':ops.push(()=>{c.health=Math.min(100,c.health+5);if(c.slot!==null){this.slots[c.slot].junction=clamp(this.slots[c.slot].junction+.1);this.lab.patches[c.slot].brush=clamp(this.lab.patches[c.slot].brush+.1);}});break;
    case 'engulf_transaction':assert(target&&dist(c,target)<this.rules.contact_radius&&this.kernel.targetOwners.get(target.id)===e.id,'Target lost.');ops.push(()=>{if(target.lab){target.state.viability='cleared';target.corpse=false;c.lab.cargo.push(`corpse:${target.id}`);}else{if(target.event){const pending=this.lab.events.find(v=>v.id===target.event);if(pending?.status==='running')pending.status='cancelled';target.event=null;}target.state='internalized';target.carrier=c.id;target.slot=null;c.lab.cargo.push(target.id);if(c.state.type==='dendritic'&&!c.v5.antigens.some(a=>a.id===target.id))c.v5.antigens.push({id:target.id,source:target.species??'EPEC',acquired_at:this.time_min,event_id:e.id});}});break;
    case 'cargo_processing':assert(c.lab.cargo.length,'Cargo missing.');ops.push(()=>{const id=c.lab.cargo.shift(),b=this.target(id);if(b&&!id.startsWith('corpse:')){b.state='killed';b.carrier=null;this.lab.bacterialBalance.killed++;}c.state.resources.phagocytic_capacity=Math.min(1,c.state.resources.phagocytic_capacity+this.param('ingestion_cost'));});break;
    case 'movement_step':{const g=this.local(c).gradient,um=this.param('chemotactic_speed')*plan.event_duration_min;ops.push(()=>{
     // Resolve a bounded path in micrometers. A surface clamp must not teleport a cell.
     const from={x:c.x,y:c.y,time_min:this.time_min,event_id:e.id};let remaining=um;
     while(remaining>1e-9){const step=Math.min(1,remaining),nx=clamp(c.x+g.x*step/300,.02,.98),ny=c.y+g.y*step/200;
      if(ny>=surface(nx)+.012&&ny<=.89){c.x=nx;c.y=ny;}else if(c.y>=surface(nx)+.012){c.x=nx;}remaining-=step;
     }
     const moved=Math.hypot((c.x-from.x)*300,(c.y-from.y)*200);c.v5.distance_um+=moved;
     if(moved>0){c.v5.trail.push(from,{x:c.x,y:c.y,time_min:this.time_min,event_id:e.id});c.v5.trail=c.v5.trail.slice(-24);}
     c.nextDecisionAt=Math.min(c.nextDecisionAt,this.time_min);
    });break;}
    case 'cancel_incompatible_events':ops.push(()=>{for(const other of this.kernel.activeEvents(c.id))if(other.id!==e.id&&this.kernel.action(other.action_id).continuation.on_death==='cancel')this.kernel.cancel(other.id,'terminal_death_precedence');});break;
    case 'death_record':ops.push(()=>this.recordDeath(c,'Manual death execution',e.id));break;
    case 'phenotype_transition':assert(c.state.type==='inflammatory_monocyte'&&effect.arguments.preserve_origin,'Invalid lineage transition.');ops.push(()=>{c.v5.phenotype='resident_like';c.v5.transitions.push({from:'inflammatory_monocyte',to:'resident_like',origin:c.v5.origin,time_min:this.time_min,event_id:e.id});c.state.programs.inflammation=0;c.state.programs.regulation=1;c.state.competence.CCL2_output=false;c.state.outputs.CCL2=0;});break;
    case 'antigen_presentation_update':{const antigen=c.v5.antigens.find(a=>!c.v5.presented.some(p=>p.id===a.id));assert(c.state.type==='dendritic'&&antigen,'Antigen provenance missing.');ops.push(()=>c.v5.presented.push({...copy(antigen),presented_at:this.time_min,event_id:e.id}));break;}
    case 'vascular_entry_transaction':assert(c.reserve,'No vascular cell.');ops.push(()=>{c.reserve=false;c.lab.compartment='basal';c.lab.recruitedAt=this.time_min;c.y=.85;});break;
    case 'target_hit':assert(target?.alive,'Living target missing.');ops.push(()=>{target.health=Math.max(0,target.health-this.param('death_signal_amount')*100);});break;
    default:throw new Error(`Unimplemented physical effect: ${effect.kind}`);
   }
  }
  c.state=state;for(const op of ops)op();this.revision++;
  const receipt={transaction_id:plan.transaction_id,committed:true,next_revision:this.revision,applied_at:this.time_min};this.appliedTransactions.set(key,{plan:copy(plan),receipt:copy(receipt)});this.kernel.acknowledge(e.id,receipt);
  c.effect=`${actionLabel(a.id)} completed at ${this.time_min} min.`;this.log(c.effect,'accepted_effect',c.id,{event_id:e.id,action_id:a.id});return copy(receipt);
 }
 advanceEnvironment(dt){
    const l=this.lab,p=ILEUM_MANIFEST,oldBacteria=copy(l.bacteria),oldPatches=copy(l.patches),proposals=[];
    const living=alive,chance=rate=>this.labRandom()<-Math.expm1(-rate*dt),distance=dist;
    for(const b of oldBacteria){
      if(!['free','attached'].includes(b.state)||b.owner||b.event||this.kernel.targetOwners.has(b.id))continue;
      const actual=l.bacteria.find(v=>v.id===b.id),i=this.nearestPatch(b.x),slot=this.slots[i],epi=this.cellById.get(slot.cell);
      if(b.species==='ETEC'&&b.compartment==='apical'){
       const near=living(epi)&&distance(b,epi)<p.bacteria.contact_radius;
       actual.contactMinutes=near?(b.contactMinutes??0)+dt:0;
       if(near&&actual.contactMinutes>=this.pack.definition.etec.colonization_contact_min){actual.state='attached';actual.slot=i;}
       if(actual.state==='attached'){
        for(const toxin of ['LT','ST'])this.fields.deposit(toxin,epi.apical,this.pack.definition.etec[toxin+'_per_bacterium_min']*dt);
        if(!living(epi)){actual.state='free';actual.slot=null;}
        continue;
       }
      }
      if(b.state==='free'){
        if(b.compartment==='apical'){
          actual.x=clamp(b.x+p.bacteria.drift*dt,.01,.99);actual.y=surface(actual.x)-.018-(surface(b.x)-b.y-.018)*Math.exp(-.3*dt);
          if(b.attachment&&living(epi)&&distance(b,epi)<p.bacteria.contact_radius&&chance(p.bacteria.attach_rate/(1+this.fields.values.MUCUS[epi.apical]*10)))proposals.push(['ILEUM_ADHESION',b.id,epi.id]);
          // Passive exposure only at severe gaps; never active EPEC invasion.
          if(slot.junction<.15&&chance(.015)){actual.compartment='basal';actual.y=slot.y+.025;}
          else if(chance(p.bacteria.washout_rate)){actual.state='washed';l.bacterialBalance.washed++;}
        }
      }else if(!epi.alive){actual.state='free';actual.slot=null;}
      if(actual.state==='attached'&&l.replicationEnabled&&l.replicationRemaining>0&&l.bacteria.length<p.bacteria.max_agents&&chance(p.bacteria.replicate_rate)){
        l.replicationRemaining--;l.bacterialBalance.born++;
        l.bacteria.push({...copy(actual),id:`epec-${l.nextBacterium++}`,state:'free',slot:null,event:null,owner:null,carrier:null,x:clamp(actual.x+(this.labRandom()-.5)*.025,.01,.99),y:actual.y-.025});
      }
    }
    for(let i=0;i<this.slots.length;i++){
      const slot=this.slots[i],q=l.patches[i],prev=oldPatches[i],c=this.cellById.get(slot.cell),attached=oldBacteria.filter(b=>b.species!=='ETEC'&&b.state==='attached'&&b.slot===i).length;
      const tnf=this.fields.values.TNF[c.basal]??0,tnfActivity=tnf/(p.innate.tnf_K+tnf);
      const mucus=this.fields.values.MUCUS[c.apical]??0;
      const leak=(1-slot.junction)*p.innate.luminal_PAMP/(1+mucus*5);
      // Proposed basal cue transport, emitted only at the actual local lesion.
      if(leak>0)this.fields.deposit('PAMP',c.basal,leak*this.rules.PAMP_leak_rate*dt);
      if(prev.DAMP>0)this.fields.deposit('DAMP',c.basal,prev.DAMP*this.rules.DAMP_release_rate*dt);
      q.PAMP=clamp(prev.PAMP+(leak+Math.min(1,attached*.15)-prev.PAMP)*(-Math.expm1(-.1*dt)));
      const neighbor=(name)=>(oldPatches[i-1]?.[name]??prev[name])+(oldPatches[i+1]?.[name]??prev[name])-2*prev[name];
      q.DAMP=Math.max(0,prev.DAMP*Math.exp(-p.innate.signal_decay*dt)+p.innate.signal_diffusion*dt*neighbor('DAMP'));
      q.IL10=Math.max(0,q.IL10*Math.exp(-p.innate.signal_decay*dt)+p.innate.signal_diffusion*dt*neighbor('IL10'));
      if(!living(c))continue;
      const damage=p.innate.damage_rate*tnfActivity/(1+q.IL10*3)+attached*p.bacteria.junction_injury_rate;
      const repair=0; // Recovery requires a manual action selected by Jev.
      slot.junction=clamp(slot.junction+(repair-damage)*dt);
      q.brush=clamp(q.brush+(0-attached*p.bacteria.brush_injury_rate)*dt);
      c.health=clamp(c.health-damage*18*dt,0,100);
      if(damage>0)q.DAMP=clamp(q.DAMP+damage*dt*4);
      c.state.damage=clamp(1-c.health/100);c.state.viability=c.health<90?'injured':'viable';if(damage>0)c.v5.injuryMinutes+=dt;
      if(attached>0)this.fields.deposit('SECRETORY_STIMULUS',c.apical,.03*attached*dt);
      c.lab.activity=attached?'EPEC contact: brush-border injury':damage>.001?'Inflammatory junction injury':slot.junction<.98?'Local junction injury':'Maintaining epithelial barrier';
      // Severe injury opens the manual commitment gate; it does not kill instantly.
    }
    for(const c of this.cells){
      if(c.type==='neutrophil'&&living(c)&&c.lab.recruitedAt!==null&&this.time_min-c.lab.recruitedAt>=p.innate.neutrophil_lifetime)this.commitSenescence(c);
      c.physical={x_um:c.x*300,y_um:c.y*200};
    }
    for(const e of l.events.filter(e=>e.status==='running')){e.active_elapsed_min=Math.min(e.duration_min,this.time_min-e.started_at);if(e.active_elapsed_min>=e.duration_min)this.finishEvent(e);}
    for(const [action,actorId,targetId]of proposals){
      const actor=this.cellById.get(actorId)??l.bacteria.find(b=>b.id===actorId),target=this.target(targetId);
      if(this.canStart(action,actor,target))this.startEvent(action,actorId,targetId);
    }
    for(const b of l.bacteria.filter(b=>b.state==='internalized')){const c=this.cellById.get(b.carrier);b.x=c.x;b.y=c.y;}
    this.transportWater(dt);
  }
 advancePhysical(){
  this.updateContinuous(1);this.fields.advance(1);this.time_min++;this.tick++;this.revision++;
  this.advanceEnvironment(1);
  // The manual mandates automatic execution after an irreversible commitment.
  // This is a consequence of a committed event, not a second discretionary choice.
  for(const c of this.cells.filter(c=>c.state.viability==='death_committed')){
   const s=this.snapshot(c),row=this.kernel.eligibility('DEATH_EXECUTION',s);
   if(row.allowed){const e=this.kernel.start('DEATH_EXECUTION',s);this.log('Committed death: terminal execution clock started.','manual_execution',c.id,{event_id:e.id});}
  }
  for(const e of [...this.kernel.events.values()].filter(e=>['running','paused','pending'].includes(e.status))){
   const c=this.cellById.get(e.cell_id),out=this.kernel.advance(e.id,this.snapshot(c,e),this.time_min);
   if(out.transaction_id)this.commitCompletion({...out,run_id:this.run_id});
  }
  for(const c of this.cells)c.physical={x_um:c.x*300,y_um:c.y*200};
 }
 recordFrame(replace=false){
  if(!this.unifiedReady){super.recordFrame(replace);return;}
  super.recordFrame(replace);const f=this.history.at(-1);f.unified={version:'5.0.0',firstDeparture:copy(this.firstDeparture),prompt:copy(this.lastPrompt),JevQuestions:this.decisions.length};
  for(const c of f.cells){const actual=this.cellById.get(c.id),l=this.local(actual);c.v5=copy(actual.v5);c.unified={...copy(actual.unified),active:l.active,reasons:l.reasons,local:{LT:l.LT,ST:l.ST,enterotoxin:l.enterotoxin,health:actual.health,damage:actual.state.damage,CCL2:l.ccl2,TNF:l.tnf,CXCL8:l.cxcl8,PAMP:l.pamp,DAMP:l.damp,pathogens:l.bacteria.length},nextDecisionAt:actual.nextDecisionAt};c.manual.preparing=c.manual.events.some(e=>['running','paused','pending'].includes(e.status));}
  f.v5={distance_um:this.cells.reduce((n,c)=>n+(c.v5?.distance_um??0),0),committed:this.cells.filter(c=>c.state.viability==='death_committed').length,dead:this.cells.filter(c=>!c.alive).length,adapted:this.cells.filter(c=>c.v5?.phenotype==='resident_like').length,presenting:this.cells.filter(c=>c.alive&&c.v5?.presented.length).length,recruited:this.cells.filter(c=>c.lab.recruitedAt!==null).length};
  f.metrics.active=f.cells.filter(c=>c.unified.active).length;f.metrics.preparing=f.cells.filter(c=>c.manual.preparing).length;f.metrics.quiet=f.metrics.alive-f.metrics.active;
  if(!this.firstDeparture&&f.metrics.active){this.firstDeparture={time_min:this.time_min,cells:f.cells.filter(c=>c.unified.active).map(c=>({id:c.id,reasons:c.unified.reasons}))};f.unified.firstDeparture=copy(this.firstDeparture);}
  f.metrics.present=this.cells.length-this.cells.filter(c=>c.state.viability==='cleared').length;f.pack_fingerprint=this.pack.fingerprint;f.lab.etecWater=this.lab.etecWater;
  this.metrics=copy(f.metrics);this.recorder?.capture(f);
 }
 export(){return {...super.export(),version:'5.0.0',mode:'unified',policy:this.policy,coverage:{manual_handlers:HOST_ACTIONS,total_manual_actions:this.registry.actions.length,full_registry:false},host_rules:this.rules,decisions:copy(this.decisions),requestAudit:copy(this.requestAudit),firstDeparture:copy(this.firstDeparture)};}
}
