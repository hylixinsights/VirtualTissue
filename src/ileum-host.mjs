import {ManualTissue} from './manual-host.mjs';
import {ILEUM_MANIFEST,ILEUM_ACTIONS} from './ileum-parameters.mjs';
import {seededRandom} from '../manual_v2/virtual_tissue_kernel.mjs';
import {isEpi,surface,clamp,GRID} from './engine.mjs';

const copy=v=>JSON.parse(JSON.stringify(v));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const living=c=>c.alive&&!['dead_present','cleared'].includes(c.state.viability);
const phagocyte=c=>['macrophage','neutrophil'].includes(c.type);
const assert=(test,message)=>{if(!test)throw new Error(message);};
export class IleumTissue extends ManualTissue {
  constructor(seed=20260919){
    super(seed);this.policy='reference_hazards_plus_ileum_P_extensions';
    this.lab={manifest:ILEUM_MANIFEST,bacteria:[],events:[],nextBacterium:1,nextEvent:1,draws:0,
      replicationRemaining:0,replicationEnabled:true,cohorts:[],
      bacterialBalance:{introduced:0,born:0,killed:0,washed:0},
      patches:this.slots.map(s=>({x:s.x,resolution:1,brush:1,PAMP:0,DAMP:0,IL10:0,water:0})),
      waterReservoir:ILEUM_MANIFEST.fluid.initial_water_reservoir,
      balance:{waterDrawn:0,waterAbsorbed:0,waterOut:0},
      series:[],lastWaterOutRate:0};
    const rng=seededRandom((this.seed^0x1ee0c011)>>>0);this.labRandom=()=>{this.lab.draws++;return rng();};
    for(const c of this.cells)c.lab={activation:0,cargo:[],event:null,last:null,compartment:c.reserve?'vascular':'basal',
      recruitedAt:null,owner:null,secretedTNF:0,tnfBudget:phagocyte(c)?ILEUM_MANIFEST.innate.tnf_budget_NAU:0,activity:'No local innate cue',resolution:1};
    this.log('Ileum experiment: EPEC attachment, innate barrier feedback are proposed extensions. Reference coverage remains 2 / 55.','ileum_start');
    this.recordFrame(true);
  }
  nearestPatch(x){let best=0;for(let i=1;i<this.slots.length;i++)if(Math.abs(this.slots[i].x-x)<Math.abs(this.slots[best].x-x))best=i;return best;}
  inject(kind,x=.25,strength=1){
    if(!this.lab)return super.inject(kind,x);
    assert(['epec','epec_control','ileitis','regulation','resolve'].includes(kind),'Unsupported ileum intervention.');
    assert(Number.isFinite(x)&&Number.isFinite(strength)&&strength===1,'Use a finite position and the declared unit intervention.');
    x=clamp(x,.055,.945);const p=ILEUM_MANIFEST;
    if(kind==='epec'||kind==='epec_control')assert(this.lab.bacteria.length+p.controls.epec_count<=p.bacteria.max_agents,'Agent limit reached. Reset before adding another EPEC bolus.');
    this.revision++;const intervention={...this.epoch(),kind,x,parameters:copy(p.controls),extension:p.version};this.interventions.push(intervention);
    if(kind==='epec'||kind==='epec_control'){
      const cohort=`bolus-${this.interventions.length}`;
      this.lab.cohorts.push({id:cohort,intimateAttachment:kind==='epec'});
      for(let i=0;i<p.controls.epec_count;i++){
        const bx=clamp(x+(this.labRandom()-.5)*.10,.02,.98);
        this.lab.bacteria.push({id:`epec-${this.lab.nextBacterium++}`,cohort,x:bx,y:surface(bx)-.055,
          state:'free',compartment:'apical',slot:null,owner:null,carrier:null,attachment:kind==='epec',event:null});
      }
      this.lab.bacterialBalance.introduced+=p.controls.epec_count;
      this.lab.replicationRemaining+=p.bacteria.replication_budget;this.lab.replicationEnabled=true;
    }else if(kind==='ileitis'){
      for(let i=0;i<this.slots.length;i++)if(Math.abs(this.slots[i].x-x)<.15){
        this.slots[i].junction=Math.min(this.slots[i].junction,p.controls.initial_junction);
        this.lab.patches[i].resolution=p.controls.reduced_resolution;
      }
    }else if(kind==='regulation'){
      for(const patch of this.lab.patches)if(Math.abs(patch.x-x)<.15)patch.resolution=1;
    }else{this.sources=[];this.lab.replicationEnabled=false;}
    this.log(`Ileum intervention: ${kind} at ${(x*300).toFixed(1)} µm.`,'ileum_intervention',null,{intervention});
    this.recordFrame(true);
  }
  target(id){return this.lab.bacteria.find(b=>b.id===id)??this.cellById.get(id);}
  canStart(action,actor,target){
    if(action==='ILEUM_ADHESION')return actor?.state==='free'&&actor.attachment&&!actor.event&&actor.compartment==='apical'&&target&&living(target)&&isEpi(target)&&distance(actor,target)<ILEUM_MANIFEST.bacteria.contact_radius;
    if(!actor||!living(actor)||actor.lab.event||actor.state.resources.energy<ILEUM_MANIFEST.innate.event_energy)return false;
    if(action==='ILEUM_VASCULAR_CROSSING'){const i=this.fields.nearest(actor.x*300,actor.y*200,'basal');return actor.type==='neutrophil'&&actor.reserve&&(actor.lab.activation>.003||this.fields.values.CXCL8[i]>.00001);}
    if(action==='ILEUM_APICAL_CROSSING')return actor.type==='neutrophil'&&!actor.reserve&&actor.lab.compartment==='basal'&&Math.abs(actor.y-surface(actor.x))<.045&&this.lab.bacteria.some(b=>b.state==='attached'&&b.compartment==='apical'&&Math.abs(b.x-actor.x)<.07);
    if(actor.reserve)return false;
    if(action==='ILEUM_CARGO_PROCESSING')return actor.lab.cargo.length>0&&target?.state==='internalized'&&target.carrier===actor.id;
    if(action==='ILEUM_PHAGOCYTOSIS')return phagocyte(actor)&&actor.lab.cargo.length<2&&target&&!target.owner&&['free','attached'].includes(target.state)&&actor.lab.compartment===target.compartment&&distance(actor,target)<ILEUM_MANIFEST.innate.reach;
    if(action==='ILEUM_EFFEROCYTOSIS')return actor.type==='macrophage'&&target?.state?.viability==='dead_present'&&!target.lab.owner&&target.lab.compartment===actor.lab.compartment&&distance(actor,target)<ILEUM_MANIFEST.innate.reach;
    return false;
  }
  startEvent(action,actorId,targetId=null){
    assert(Object.hasOwn(ILEUM_ACTIONS,action),'Unknown ileum event.');
    const actor=this.cellById.get(actorId)??this.lab.bacteria.find(b=>b.id===actorId),target=this.target(targetId);
    assert(this.canStart(action,actor,target),'Ileum event gate or target ownership failed.');
    const p=ILEUM_MANIFEST,minutes={ILEUM_ADHESION:p.bacteria.adhesion_min,ILEUM_PHAGOCYTOSIS:p.innate.phagocytosis_min,
      ILEUM_CARGO_PROCESSING:p.innate.processing_min,ILEUM_VASCULAR_CROSSING:p.innate.crossing_min,
      ILEUM_APICAL_CROSSING:p.innate.apical_crossing_min,ILEUM_EFFEROCYTOSIS:p.innate.efferocytosis_min};
    const e={id:`ileum-event-${this.lab.nextEvent++}`,action_id:action,cell_id:actorId,target_id:targetId,
      status:'running',started_at:this.time_min,duration_min:minutes[action],active_elapsed_min:0,reserved_energy:action==='ILEUM_ADHESION'?0:ILEUM_MANIFEST.innate.event_energy,evidence:'P'};
    this.lab.events.push(e);
    if(action==='ILEUM_ADHESION')actor.event=e.id;else actor.lab.event=e.id;
    if(['ILEUM_PHAGOCYTOSIS','ILEUM_EFFEROCYTOSIS'].includes(action)){
      if(target.lab)target.lab.owner=e.id;else target.owner=e.id;
    }
    this.totalDecisions++;this.log(`${ILEUM_ACTIONS[action]} started; ${e.duration_min} min.`,'ileum_event_start',actorId,{event_id:e.id,target:targetId});
    return copy(e);
  }
  finishEvent(e){
    if(e.status!=='running')return false;
    const actor=this.cellById.get(e.cell_id)??this.lab.bacteria.find(b=>b.id===e.cell_id),target=this.target(e.target_id);
    const owned=target&&(target.lab?target.lab.owner:target.owner)===e.id;
    let valid=!!actor&&(e.action_id==='ILEUM_ADHESION'?actor.state==='free'&&actor.event===e.id&&living(target)&&distance(actor,target)<ILEUM_MANIFEST.bacteria.contact_radius:living(actor)&&actor.lab.event===e.id&&actor.state.resources.energy>=e.reserved_energy);
    if(e.action_id==='ILEUM_PHAGOCYTOSIS')valid=valid&&owned&&['free','attached'].includes(target.state)&&actor.lab.compartment===target.compartment&&distance(actor,target)<ILEUM_MANIFEST.innate.reach;
    if(e.action_id==='ILEUM_EFFEROCYTOSIS')valid=valid&&owned&&target.state.viability==='dead_present'&&distance(actor,target)<ILEUM_MANIFEST.innate.reach;
    if(e.action_id==='ILEUM_CARGO_PROCESSING')valid=valid&&target?.state==='internalized'&&target.carrier===actor.id;
    // Never apply early; retries are inert once the event is acknowledged.
    if(valid&&this.time_min-e.started_at+1e-9<e.duration_min)return false;
    if(valid){
      if(actor.lab)actor.state.resources.energy-=e.reserved_energy;
      switch(e.action_id){
        case 'ILEUM_ADHESION':actor.state='attached';actor.slot=target.slot;actor.x=target.x;actor.y=target.y-.018;break;
        case 'ILEUM_PHAGOCYTOSIS':
          if(target.event){const pending=this.lab.events.find(v=>v.id===target.event);if(pending?.status==='running'){pending.status='cancelled';pending.cancel_reason='Bacterium engulfed before attachment completed';}target.event=null;}
          target.state='internalized';target.carrier=actor.id;target.slot=null;actor.lab.cargo.push(target.id);break;
        case 'ILEUM_CARGO_PROCESSING':target.state='killed';target.carrier=null;actor.lab.cargo=actor.lab.cargo.filter(id=>id!==target.id);this.lab.bacterialBalance.killed++;break;
        case 'ILEUM_VASCULAR_CROSSING':actor.reserve=false;actor.lab.compartment='basal';actor.lab.recruitedAt=this.time_min;actor.y=.85;break;
        case 'ILEUM_APICAL_CROSSING':actor.lab.compartment='apical';actor.y=surface(actor.x)-.018;break;
        case 'ILEUM_EFFEROCYTOSIS':target.state.viability='cleared';target.corpse=false;this.lab.patches[this.nearestPatch(actor.x)].IL10+=.2;break;
      }
      e.status='acknowledged';e.acknowledged_at=this.time_min;
      if(actor.lab){actor.lab.last={time_min:this.time_min,action_id:e.action_id,target_id:e.target_id};actor.lastDecisionTick=this.tick;actor.effect=`${ILEUM_ACTIONS[e.action_id]} completed (${e.target_id??'boundary'}).`;}
      this.log(`${ILEUM_ACTIONS[e.action_id]} completed.`,'ileum_accepted',e.cell_id,{event_id:e.id,target:e.target_id});
    }else{e.status='cancelled';e.cancel_reason='Actor, contact or target ownership no longer valid';this.log(`${ILEUM_ACTIONS[e.action_id]} cancelled.`,'ileum_cancelled',e.cell_id,{event_id:e.id});}
    if(actor?.lab?.event===e.id)actor.lab.event=null;if(actor?.event===e.id)actor.event=null;
    if(owned){if(target.lab)target.lab.owner=null;else target.owner=null;}
    return valid;
  }
  transportWater(dt){
    const l=this.lab,p=ILEUM_MANIFEST.fluid,patches=l.patches;
    for(const patch of patches){
      const reabsorbed=patch.water*(-Math.expm1(-p.water_reabsorption_rate*dt));
      patch.water-=reabsorbed;l.waterReservoir+=reabsorbed;l.balance.waterAbsorbed+=reabsorbed;
    }
    const amounts=patches.map(q=>q.water*(-Math.expm1(-p.transit_rate*dt)));
    for(let i=0;i<patches.length;i++)patches[i].water+=(i?amounts[i-1]:0)-amounts[i];
    l.balance.waterOut+=amounts.at(-1);l.lastWaterOutRate=amounts.at(-1)/dt;
  }
  advanceLab(dt){
    const l=this.lab,p=ILEUM_MANIFEST,oldCells=copy(this.cells).sort((a,b)=>a.id.localeCompare(b.id)),oldBacteria=copy(l.bacteria).sort((a,b)=>a.id.localeCompare(b.id)),oldPatches=copy(l.patches);
    const oldTNF=this.fields.values.TNF.slice(),oldCXCL8=this.fields.values.CXCL8.slice();
    const proposals=[];
    const chance=rate=>this.labRandom()<-Math.expm1(-rate*dt);
    for(const c of oldCells){
      if(!living(c)||!phagocyte(c))continue;
      const actual=this.cellById.get(c.id),i=this.nearestPatch(c.x),patch=oldPatches[i],slot=this.slots[i];
      const basal=this.fields.nearest(c.x*300,c.y*200,'basal'),tnf=oldTNF[basal],cxcl8=oldCXCL8[basal];
      const nearSurface=Math.exp(-Math.max(0,c.y-slot.y)/.22);
      const drive=clamp((patch.PAMP+patch.DAMP)*nearSurface+tnf/(p.innate.tnf_K+tnf));
      actual.lab.activation=clamp(c.lab.activation+(drive-c.lab.activation)*(-Math.expm1(-dt/p.innate.activation_tau)));
      actual.lab.resolution=patch.resolution;
      const secretion=!c.reserve&&c.lab.compartment==='basal'?p.innate.tnf_rate*c.lab.activation/(1+patch.IL10*4):0;
      const output=Math.min(c.lab.tnfBudget,secretion*dt);
      if(output>1e-8){this.fields.deposit('TNF',basal,output);actual.lab.secretedTNF+=output;actual.lab.tnfBudget-=output;}
      actual.lab.activity=c.reserve?'Sensing vascular recruitment cues':output>.001?'Secreting local TNF':c.lab.activation>.05?'Sensing local innate cues':'No local innate cue';
      if(c.type==='macrophage')l.patches[i].IL10+=patch.resolution*c.lab.activation*.03*dt;
      if(c.lab.event)continue;
      const cargo=oldBacteria.find(b=>b.carrier===c.id&&b.state==='internalized');
      const target=oldBacteria.find(b=>!b.owner&&['free','attached'].includes(b.state)&&b.compartment===c.lab.compartment&&distance(c,b)<p.innate.reach);
      const corpse=oldCells.find(v=>v.state.viability==='dead_present'&&!v.lab.owner&&v.lab.compartment===c.lab.compartment&&distance(c,v)<p.innate.reach);
      let action=null,targetId=null;
      if(c.reserve){if(cxcl8>.00001||drive>.015){action='ILEUM_VASCULAR_CROSSING';}}
      else if(cargo){action='ILEUM_CARGO_PROCESSING';targetId=cargo.id;}
      else if(target&&c.lab.cargo.length<2){action='ILEUM_PHAGOCYTOSIS';targetId=target.id;}
      else if(c.type==='macrophage'&&corpse){action='ILEUM_EFFEROCYTOSIS';targetId=corpse.id;}
      else if(c.type==='neutrophil'&&c.lab.compartment==='basal'&&Math.abs(c.y-surface(c.x))<.045&&oldBacteria.some(b=>b.compartment==='apical'&&b.state==='attached'&&Math.abs(b.x-c.x)<.07)){action='ILEUM_APICAL_CROSSING';}
      if(action&&chance(p.innate.event_rate))proposals.push([action,c.id,targetId]);
      if(!c.reserve&&!action){
        // Follow the nearest sensed focus; finite sensing range, no whole-tissue prompt.
        let goal=null,best=0;
        for(let j=0;j<oldPatches.length;j++){
          const q=oldPatches[j],d=Math.hypot(q.x-c.x,this.slots[j].y-c.y);
          if(d>.50)continue;
          const fi=this.fields.nearest(q.x*300,this.slots[j].y*200,'basal');
          const score=(q.PAMP+q.DAMP+oldCXCL8[fi]*10)/(d+.05);
          if(score>best){best=score;goal={x:q.x,y:this.slots[j].y+(c.lab.compartment==='apical'?-.018:.025)};}
        }
        if(goal&&best>.01){const d=distance(c,goal),f=Math.min(1,p.innate.speed*dt/Math.max(d,1e-9));actual.x=c.x+(goal.x-c.x)*f;actual.y=c.y+(goal.y-c.y)*f;
          actual.y=c.lab.compartment==='apical'?Math.min(actual.y,surface(actual.x)-.012):Math.max(actual.y,surface(actual.x)+.012);actual.lab.activity='Migrating toward a local signal';}
      }
    }
    for(const b of oldBacteria){
      if(!['free','attached'].includes(b.state)||b.owner||b.event)continue;
      const actual=l.bacteria.find(v=>v.id===b.id),i=this.nearestPatch(b.x),slot=this.slots[i],epi=this.cellById.get(slot.cell);
      if(b.state==='free'){
        if(b.compartment==='apical'){
          actual.x=clamp(b.x+p.bacteria.drift*dt,.01,.99);actual.y=surface(actual.x)-.018-(surface(b.x)-b.y-.018)*Math.exp(-.3*dt);
          if(b.attachment&&living(epi)&&distance(b,epi)<p.bacteria.contact_radius&&chance(p.bacteria.attach_rate/(1+this.fields.values.MUCUS[epi.apical]*10)))proposals.push(['ILEUM_ADHESION',b.id,epi.id]);
          // Passive exposure only at severe gaps; never active EPEC invasion.
          if(slot.junction<.15&&chance(.015)){actual.compartment='basal';actual.y=slot.y+.025;}
          else if(chance(p.bacteria.washout_rate)){actual.state='washed';l.bacterialBalance.washed++;}
        }
      }else if(!living(epi)){actual.state='free';actual.slot=null;}
      if(actual.state==='attached'&&l.replicationEnabled&&l.replicationRemaining>0&&l.bacteria.length<p.bacteria.max_agents&&chance(p.bacteria.replicate_rate)){
        l.replicationRemaining--;l.bacterialBalance.born++;
        l.bacteria.push({...copy(actual),id:`epec-${l.nextBacterium++}`,state:'free',slot:null,event:null,owner:null,carrier:null,x:clamp(actual.x+(this.labRandom()-.5)*.025,.01,.99),y:actual.y-.025});
      }
    }
    for(let i=0;i<this.slots.length;i++){
      const slot=this.slots[i],q=l.patches[i],prev=oldPatches[i],c=this.cellById.get(slot.cell),attached=oldBacteria.filter(b=>b.state==='attached'&&b.slot===i).length;
      const tnf=this.fields.values.TNF[c.basal]??0,tnfActivity=tnf/(p.innate.tnf_K+tnf);
      const mucus=this.fields.values.MUCUS[c.apical]??0;
      const leak=(1-slot.junction)*p.innate.luminal_PAMP/(1+mucus*5);
      q.PAMP=clamp(prev.PAMP+(leak+Math.min(1,attached*.15)-prev.PAMP)*(-Math.expm1(-.1*dt)));
      const neighbor=(name)=>(oldPatches[i-1]?.[name]??prev[name])+(oldPatches[i+1]?.[name]??prev[name])-2*prev[name];
      q.DAMP=Math.max(0,prev.DAMP*Math.exp(-p.innate.signal_decay*dt)+p.innate.signal_diffusion*dt*neighbor('DAMP'));
      q.IL10=Math.max(0,q.IL10*Math.exp(-p.innate.signal_decay*dt)+p.innate.signal_diffusion*dt*neighbor('IL10'));
      if(!living(c))continue;
      const damage=p.innate.damage_rate*tnfActivity/(1+q.IL10*3)+attached*p.bacteria.junction_injury_rate;
      const repair=p.innate.repair_rate*q.resolution*(1-tnfActivity)*(1-slot.junction);
      slot.junction=clamp(slot.junction+(repair-damage)*dt);
      q.brush=clamp(q.brush+(p.innate.brush_repair_rate*q.resolution*(1-q.brush)-attached*p.bacteria.brush_injury_rate)*dt);
      c.health=clamp(c.health+(.08*q.resolution*(1-tnfActivity)-damage*18)*dt,0,100);
      if(damage>0)q.DAMP=clamp(q.DAMP+damage*dt*4);
      c.state.viability=c.health<90?'injured':'viable';
      if(attached>0)this.fields.deposit('SECRETORY_STIMULUS',c.apical,.03*attached*dt);
      c.lab.activity=attached?'EPEC contact: brush-border injury':damage>.001?'Inflammatory junction injury':slot.junction<.98?'Restoring surviving-cell junctions':'Maintaining epithelial barrier';
      if(c.health<=p.innate.death_health)this.killCell(c,'inflammatory epithelial loss');
    }
    for(const c of this.cells){
      if(c.type==='neutrophil'&&living(c)&&c.lab.recruitedAt!==null&&this.time_min-c.lab.recruitedAt>=p.innate.neutrophil_lifetime)this.killCell(c,'finite recruited-neutrophil lifetime');
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
  killCell(c,reason){
    if(!living(c))return;
    c.alive=false;c.corpse=true;c.health=0;c.state.viability='dead_present';c.deathTick=this.tick;c.deathKind='apoptosis';
    if(c.slot!==null)this.slots[c.slot].junction=0;
    for(const id of c.lab.cargo){const b=this.target(id);b.state='free';b.carrier=null;b.compartment=c.lab.compartment;b.owner=null;}c.lab.cargo=[];
    this.lab.patches[this.nearestPatch(c.x)].DAMP+=.3;
    this.log(`Cell lost: ${reason}. No replacement cell is created.`,'ileum_death',c.id);
  }
  advanceOne(dt){super.advanceOne(dt);this.advanceLab(dt);}
  auditLab(){
    const l=this.lab,sum=k=>l.patches.reduce((n,q)=>n+q[k],0),balance=l.balance;
    const count=s=>l.bacteria.filter(b=>b.state===s).length;
    return {bacteria:{...l.bacterialBalance,free:count('free'),attached:count('attached'),internalized:count('internalized'),
      residual:l.bacterialBalance.introduced+l.bacterialBalance.born-count('free')-count('attached')-count('internalized')-l.bacterialBalance.killed-l.bacterialBalance.washed},
      water:{drawn:balance.waterDrawn,retained:sum('water'),absorbed:balance.waterAbsorbed,out:balance.waterOut,outRate:l.lastWaterOutRate,reservoir:l.waterReservoir,
        residual:balance.waterDrawn-sum('water')-balance.waterAbsorbed-balance.waterOut,
        systemResidual:ILEUM_MANIFEST.fluid.initial_water_reservoir-l.waterReservoir-sum('water')-balance.waterOut}};
  }
  recordFrame(replace=false){
    super.recordFrame(replace);if(!this.lab)return;
    const f=this.history.at(-1),l=this.lab;
    for(const c of f.cells){const i=this.nearestPatch(c.x);c.lab.patch=copy(l.patches[i]);c.lab.events=copy(l.events.filter(e=>e.cell_id===c.id));c.lab.event=c.lab.events.find(e=>e.status==='running')??null;}
    const alive=this.cells.filter(living),cleared=this.cells.filter(c=>c.state.viability==='cleared').length;
    Object.assign(f.metrics,{alive:alive.length,present:100-cleared,inTissue:this.cells.filter(c=>!c.reserve&&c.state.viability!=='cleared').length,
      reserve:alive.filter(c=>c.reserve).length,recruited:this.cells.filter(c=>c.lab.recruitedAt!==null).length,
      dead:this.cells.filter(c=>c.state.viability==='dead_present').length,cleared,
      gaps:this.slots.filter(s=>!living(this.cellById.get(s.cell))).length,
      barrier:this.slots.reduce((n,s)=>n+s.junction,0)/this.slots.length,
      inflammation:this.fields.amount('TNF'),active:alive.filter(c=>c.lab.activation>.05||c.lab.event||c.lastCXCL8Flux>0).length});
    f.lab={manifest:l.manifest.version,audit:this.auditLab(),bacteria:copy(l.bacteria),patches:copy(l.patches),
      accepted:l.events.filter(e=>e.status==='acknowledged').length,scope:l.manifest.scope};
    this.metrics=copy(f.metrics);
    const summary={time_min:this.time_min,barrier:f.metrics.barrier,tnf_NAU:f.metrics.inflammation,...copy(f.lab.audit)};
    if(l.series.at(-1)?.time_min===this.time_min)l.series[l.series.length-1]=summary;else l.series.push(summary);
    for(const name of ['WATER'])f.fields[name]=Array.from({length:GRID.w*GRID.h},(_,idx)=>{
      const x=(idx%GRID.w)/(GRID.w-1),y=Math.floor(idx/GRID.w)/(GRID.h-1);
      if(y>=surface(x)||y<surface(x)-.12)return 0;
      const q=l.patches[this.nearestPatch(x)],v=q.water;return 1-Math.exp(-v);
    });
  }
  export(){const result=super.export();return {...result,version:'3.5.0',mode:'ileum',extension:copy(this.lab),extension_rng:{seed:(this.seed^0x1ee0c011)>>>0,draws:this.lab.draws},extensionAudit:this.auditLab()};}
}
