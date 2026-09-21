import registry from '../manual_v2/virtual_tissue_rules_v2.json' with {type:'json'};
import {RuleKernel, seededRandom, sampleCompeting, receptorActivity, exactMemory, boundedFlux, readPath, writePath, evaluatePredicate, validateRegistry} from '../manual_v2/virtual_tissue_kernel.mjs';
import {freezeSnapshot, prepareAdvisoryBatch, validateCompleteChannelReply} from '../integration/manual_contract.mjs';
import {Tissue, TYPES, isEpi, surface, clamp} from './engine.mjs';
import {CompartmentFields, MANUAL_FIELDS} from './manual-fields.mjs';
import {MANUAL_HOST_MANIFEST} from './manual-parameters.mjs';

const clone=x=>JSON.parse(JSON.stringify(x));
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const active=e=>['running','paused','pending'].includes(e.status);
export const MANUAL_HANDLERS=Object.freeze(['EPITHELIAL_CXCL8_INDUCTION','GOBLET_RELEASE']);
export const MANUAL_CAPABILITIES=Object.freeze(['immutable_snapshot','unique_cell_ids','atomic_commit','event_log','resource_ledger','field_transport','stores']);
let runSerial=0;
export function newRunId(){return globalThis.crypto?.randomUUID?.()??`run-${Date.now()}-${++runSerial}`;}
export function manualCoverage(){
  return {mode:'reduced_epithelial_reference',implemented:MANUAL_HANDLERS.length,total:registry.actions.length,
    actions:registry.actions.map(a=>({id:a.id,implemented:MANUAL_HANDLERS.includes(a.id),
      reason:MANUAL_HANDLERS.includes(a.id)?null:'Host handler is not implemented; this is not a biological impossibility claim.',
      required_capabilities:a.required_host_capabilities})),
    capabilities:[...MANUAL_CAPABILITIES],full_healthy_preset:false,calibrated:false,manual_jev_endpoint:false};
}
export function parseManualPrompt(text){
  const t=text.toLowerCase().trim(),x=/right/.test(t)?.76:/center|centre|middle/.test(t)?.5:.25;
  let kind=/remove|stop|withdraw/.test(t)?'resolve':/combined|both/.test(t)?'combined':/tnf/.test(t)?'tnf':/secretory|goblet|mucus/.test(t)?'secretory':null;
  if(/pathogen|bacter|cas[p]?4|tear|crohn|microplastic/.test(t))kind=null;
  if(!kind)return {valid:false,error:'Use a TNF source, a synthetic secretory stimulus, both stimuli, or remove sources. Pathogen access, injury and disease scenarios have no Manual v2 host handler.'};
  const p=MANUAL_HOST_MANIFEST.interventions;
  const fields=kind==='combined'?['TNF','SECRETORY_STIMULUS']:kind==='tnf'?['TNF']:kind==='secretory'?['SECRETORY_STIMULUS']:[];
  return {valid:true,kind,x,strength:1,title:kind==='resolve'?'Stop external sources':'A declared local stimulus',
    description:kind==='resolve'?'Stop future external deposition. Existing fields, memories, stores and events are retained.':
      fields.map(k=>`${k} → ${MANUAL_FIELDS[k]}: ${p.source_rate_NAU_per_min} NAU/min for ${p.duration_min} min, normalized over accessible voxels within ${p.radius_um} µm.`).join(' '),
    note:'P: synthetic demonstration input. Only the named external fields change; cells still pass gates, sample hazards and complete biological clocks.'};
}

export class ManualTissue {
  constructor(seed=20260919){
    validateRegistry(registry);this.registry=registry;this.seed=seed>>>0;this.run_id=newRunId();this.mode='manual';
    this.tick=0;this.revision=0;this.time_min=0;this.policy='reference_hazards';this.manifest=MANUAL_HOST_MANIFEST;
    this.kernel=new RuleKernel(registry,{seed:this.seed,capabilities:MANUAL_CAPABILITIES});
    const random=this.kernel.rng;this.rngDraws=0;this.kernel.rng=()=>{this.rngDraws++;return random();};
    const tie=seededRandom(this.seed^0x54a92d73);this.tieDraws=0;this.tieRandom=()=>{this.tieDraws++;return tie();};
    this.fields=new CompartmentFields();
    // Reuse only initialization geometry and the explicitly named legacy roster.
    // No legacy update, cytokine, death, repair or recruitment method is called.
    const geometry=new Tissue(this.seed);
    this.cells=geometry.cells.map(c=>({...clone(c),id:`cell-${String(c.id).padStart(3,'0')}`,visualIndex:c.id,
      action:'rest',source:'Manual v2 reference',effect:'No accepted physical effect.',lastDecisionTick:null,
      physical:{x_um:c.x*this.manifest.geometry.width_um,y_um:c.y*this.manifest.geometry.height_um},
      access:{apical:isEpi(c),basal:isEpi(c)},
      state:{id:`cell-${String(c.id).padStart(3,'0')}`,type:c.type,viability:'viable',
        resources:{energy:1},stores:c.type==='goblet'?{granules:1}:{},outputs:isEpi(c)?{CXCL8:0}:{},
        competence:isEpi(c)?{CXCL8_output:true,TNFR:1,...(c.type==='goblet'?{local_secretory_stimulus:true}:{})}:{},
        memory:isEpi(c)?{alarm:0}:{},programs:isEpi(c)?{inflammation:.6}:{}},
      substrate:{CXCL8:isEpi(c)?1:0,energy:isEpi(c)?1:0,granules:c.type==='goblet'?1:0},
      accounting:{CXCL8_emitted:0,granules_emitted:0,granules_refilled:0,energy_spent:0,energy_refilled:0}
    }));
    this.cellById=new Map(this.cells.map(c=>[c.id,c]));
    this.slots=geometry.slots.map(s=>({...s,cell:this.cells[s.cell].id,mucus:0}));
    for(const c of this.cells)if(isEpi(c)){
      c.apical=this.fields.nearest(c.physical.x_um,c.physical.y_um,'apical');
      c.basal=this.fields.nearest(c.physical.x_um,c.physical.y_um,'basal');
    }
    this.events=[];this.eventLog=[];this.records=[];this.history=[];this.sources=[];this.interventions=[];this.providerRequests=[];
    this.appliedTransactions=new Map();this.totalDecisions=0;this.apiCalls=0;this.apiTokens=0;this.communication=true;
    this.log('Reduced Manual v2 host: 100 initial cells; 50 epithelial cells can use implemented routes. Other cells remain visible and inactive.','start');
    this.recordFrame();
  }
  param(name){return this.registry.parameters[name].value;}
  epoch(){return {run_id:this.run_id,tick:this.tick,revision:this.revision,time_min:this.time_min};}
  log(text,kind='event',cell=null,detail={}){
    const row={...this.epoch(),text,kind,cell,...clone(detail)};this.eventLog.push(row);this.events.unshift(row);if(this.events.length>120)this.events.pop();
  }
  sensed(c){
    const signals={};
    if(c.access.basal&&Number.isInteger(c.basal))signals.TNF=this.fields.values.TNF[c.basal];
    if(c.access.apical&&Number.isInteger(c.apical)&&c.state.competence.local_secretory_stimulus!==undefined){
      signals.secretory_stimulus=receptorActivity(this.fields.values.SECRETORY_STIMULUS[c.apical],this.param('receptor_K'),this.param('hill_n'),c.state.competence.local_secretory_stimulus?1:0);
    }
    return signals;
  }
  snapshot(c){
    return freezeSnapshot({...this.epoch(),cell:c.state,state:{substrate:c.substrate},signals:this.sensed(c),
      context:{species:'human',epithelial_surface:isEpi(c)&&c.access.apical&&c.access.basal,
        apical_access:c.access.apical,basal_access:c.access.basal,physical_position:c.physical},
      provenance:{source_kind:'proposed_prior',scope:this.manifest.scope,uncertainty:this.manifest.uncertainty,manifest_version:this.manifest.version}});
  }
  candidates(c,snapshot=this.snapshot(c)){
    if(!this.registry.cell_types[c.type])return [{action_id:'UNMAPPED_LEGACY_TYPE',allowed:false,reasons:['Generic macrophage has no automatic resident-macrophage mapping. No host handler.']}];
    return this.registry.cell_types[c.type].allowed_actions.map(id=>{
      let row;
      try{row=this.kernel.eligibility(id,snapshot);}catch(error){row={action_id:id,allowed:false,reasons:[error.code??'MISSING_INPUT',error.message]};}
      const reasons=[...row.reasons];if(!MANUAL_HANDLERS.includes(id))reasons.unshift('UNIMPLEMENTED_HOST_HANDLER');
      const gate_details=[];
      const explain=p=>{
        if(evaluatePredicate(p,snapshot,this.registry))return;
        if(p.all||p.any){(p.all??p.any).forEach(explain);return;}
        const value=readPath(snapshot,p.path),expected=p.param?this.param(p.param):p.value;
        gate_details.push(`${value===undefined?'MISSING_INPUT':'FAILED_GATE'}: ${p.path} = ${JSON.stringify(value)??'missing'}; requires ${p.op} ${JSON.stringify(expected)}`);
      };
      explain(this.kernel.action(id).gate);explain(this.kernel.action(id).trigger);
      return {...row,allowed:row.allowed&&MANUAL_HANDLERS.includes(id),reasons,gate_details};
    });
  }
  collectProposals(snapshots,dt){
    const proposed=[],diagnostics=[];
    for(const s of [...snapshots].sort((a,b)=>a.cell.id.localeCompare(b.cell.id))){
      const c=this.cellById.get(s.cell.id),rows=this.candidates(c,s),groups=new Map();
      diagnostics.push({id:c.id,candidates:rows.filter(r=>MANUAL_HANDLERS.includes(r.action_id))});
      for(const row of rows.filter(r=>r.allowed)){
        if(!groups.has(row.channel))groups.set(row.channel,[]);groups.get(row.channel).push(row);
      }
      for(const [channel,group]of groups){
        const choice=sampleCompeting(group,dt,this.kernel.rng);
        if(choice)proposed.push({...choice,channel,cell_id:c.id,tick:s.tick,revision:s.revision,
          proposed_start_min:s.time_min+choice.waiting_minutes,tie:this.tieRandom(),hazards:clone(group)});
      }
    }
    proposed.sort((a,b)=>a.proposed_start_min-b.proposed_start_min||a.tie-b.tie||a.cell_id.localeCompare(b.cell_id)||a.action_id.localeCompare(b.action_id));
    return {proposed,diagnostics};
  }
  inject(kind,x=.25){
    assert(['tnf','secretory','combined','resolve'].includes(kind),'Unsupported Manual v2 intervention.');
    assert(Number.isFinite(x),'Invalid position.');x=clamp(x,.055,.945);
    const p=this.manifest.interventions;
    this.revision++;this.interventions.push({...this.epoch(),kind,x,parameters:clone(p)});
    if(kind==='resolve')this.sources=[];
    else for(const field of kind==='combined'?['TNF','SECRETORY_STIMULUS']:[kind==='tnf'?'TNF':'SECRETORY_STIMULUS']){
      const center=this.fields.nearest(x*300,surface(x)*200,MANUAL_FIELDS[field]);
      const weights=[];let total=0;
      for(let i=0;i<this.fields.side.length;i++)if(this.fields.side[i]===MANUAL_FIELDS[field]){
        const distance=Math.hypot((i%this.fields.w-center%this.fields.w)*10,(Math.floor(i/this.fields.w)-Math.floor(center/this.fields.w))*10);
        if(distance<=p.radius_um){const weight=Math.exp(-2*(distance/p.radius_um)**2);weights.push([i,weight]);total+=weight;}
      }
      this.sources.push({id:`source-${this.interventions.length}-${field}`,field,kind,x,y:surface(x),weights:weights.map(([i,w])=>[i,w/total]),
        rate:p.source_rate_NAU_per_min,started_at:this.time_min,until:this.time_min+p.duration_min});
    }
    this.log(kind==='resolve'?'External sources stopped; existing fields and memories persist.':`Applied ${kind} source at ${(x*300).toFixed(1)} µm. No cellular decision was scripted.`,'intervention');
    this.recordFrame(true);
  }
  updateContinuous(dt){
    for(const c of this.cells.filter(isEpi)){
      const s=this.sensed(c),state=c.state;
      c.lastCXCL8Flux=0;
      // Missing functional competence or input does not become a fabricated signal.
      if(s.TNF!==undefined&&Number.isFinite(state.competence.TNFR)&&Number.isFinite(state.memory.alarm)){
        const activity=receptorActivity(s.TNF,this.param('receptor_K'),this.param('hill_n'),state.competence.TNFR);
        state.memory.alarm=exactMemory(state.memory.alarm,activity,this.param('memory_tau'),dt);
      }
      if(state.viability!=='viable'&&state.viability!=='injured')continue;
      if(Number.isFinite(state.resources.energy)){
        const energy=boundedFlux(this.param('resource_recovery_rate'),1,dt,Math.min(c.substrate.energy,Math.max(0,1-state.resources.energy))).amount;
        state.resources.energy+=energy;c.substrate.energy-=energy;c.accounting.energy_refilled+=energy;
      }
      if(c.type==='goblet'&&state.competence.local_secretory_stimulus===true&&Number.isFinite(state.stores.granules)){
        const refill=boundedFlux(this.param('store_refill_rate'),1,dt,Math.min(c.substrate.granules,1-state.stores.granules)).amount;
        state.stores.granules+=refill;c.substrate.granules-=refill;c.accounting.granules_refilled+=refill;
      }
      if(Number.isFinite(state.outputs.CXCL8)){
        // Exact integral of the decaying capacity over this interval. A completion
        // at the endpoint cannot produce secretion retroactively in this interval.
        const k=this.param('soluble_output_decay'),mean=state.outputs.CXCL8*(-Math.expm1(-k*dt))/(k*dt);
        const availableEnergy=this.kernel.environment({cell:state}).cell.resources.energy;
        if(c.access.basal&&state.competence.CXCL8_output===true&&availableEnergy>=this.param('resource_gate')){
          const amount=boundedFlux(this.param('output_rate'),mean,dt,c.substrate.CXCL8).amount;
          this.fields.deposit('CXCL8',c.basal,amount);c.substrate.CXCL8-=amount;c.accounting.CXCL8_emitted+=amount;
          c.lastCXCL8Flux=amount/dt;
        }
        state.outputs.CXCL8*=Math.exp(-k*dt);
      }
    }
  }
  completionPlan(eventId){return {...this.kernel.completionPlan(eventId),run_id:this.run_id};}
  commitCompletion(plan,{acknowledge=true}={}){
    assert(plan.run_id===this.run_id,'Completion belongs to another run.');
    const key=`${this.run_id}:${plan.transaction_id}`,prior=this.appliedTransactions.get(key);
    if(prior){
      assert(JSON.stringify(prior.plan)===JSON.stringify(plan),'Transaction retry changed its payload.');
      if(acknowledge)this.kernel.acknowledge(plan.event_id,prior.receipt);
      return clone(prior.receipt);
    }
    const canonical=this.completionPlan(plan.event_id);
    assert(JSON.stringify(plan)===JSON.stringify(canonical),'Completion payload differs from the kernel plan.');
    assert(MANUAL_HANDLERS.includes(plan.action_id),'No implemented host handler.');
    const c=this.cellById.get(plan.cell_id);assert(c,'Unknown cell.');
    const e=this.kernel.getEvent(plan.event_id),action=this.kernel.action(plan.action_id);
    assert(this.time_min>=plan.ready_at&&e.status==='pending'&&!e.completion_blocked,'Event is not ready.');
    assert(evaluatePredicate(action.continuation.recheck_predicate,this.kernel.environment(this.snapshot(c),e.id),this.registry),'Completion continuation gate failed.');
    const next=clone(c.state),nextAccounting=clone(c.accounting),deposits=[];
    for(const cost of plan.reserved_costs){
      const total=readPath({cell:next},cost.path);
      assert(Number.isFinite(total)&&total>=cost.amount,'Reserved inventory is no longer available.');
      writePath({cell:next},cost.path,total-cost.amount);
      if(cost.path==='cell.resources.energy')nextAccounting.energy_spent+=cost.amount;
    }
    for(const effect of plan.effects){
      if(effect.op==='set'){
        assert(plan.action_id==='EPITHELIAL_CXCL8_INDUCTION'&&effect.path==='cell.outputs.CXCL8'&&effect.value===1,'Unsupported assignment.');
        assert(c.access.basal,'Basal access is unavailable.');writePath({cell:next},effect.path,effect.value);
      }else{
        assert(effect.kind==='stored_release'&&effect.arguments.mediator==='MUCUS'&&effect.arguments.compartment==='lumen','Unsupported physical intent.');
        assert(c.access.apical&&this.fields.side[c.apical]==='apical','Apical access is unavailable.');
        const amount=plan.reserved_costs.find(x=>x.path===effect.arguments.amount_from_reserved_path)?.amount;
        assert(Number.isFinite(amount)&&amount>=0,'Missing reserved release amount.');
        deposits.push({field:'MUCUS',index:c.apical,amount});nextAccounting.granules_emitted+=amount;
      }
    }
    for(const d of deposits)assert(this.fields.side[d.index]===MANUAL_FIELDS[d.field]&&Number.isFinite(this.fields.values[d.field][d.index]+d.amount/this.fields.volume),'Invalid field destination.');
    // All validation precedes the synchronous physical swap. Persist the receipt
    // in the episode ledger BEFORE acknowledgement, so a retry cannot apply twice.
    const receipt={transaction_id:plan.transaction_id,committed:true,next_revision:this.revision+1,applied_at:this.time_min};
    c.state=next;c.accounting=nextAccounting;
    for(const d of deposits)this.fields.deposit(d.field,d.index,d.amount);
    this.revision=receipt.next_revision;this.appliedTransactions.set(key,{plan:clone(plan),receipt:clone(receipt)});
    c.lastDecisionTick=this.tick;c.action=plan.action_id;c.effect=plan.action_id==='GOBLET_RELEASE'?'Accepted: reserved mucus emitted once into the apical compartment.':'Accepted: CXCL8 capacity increased. Bounded basal secretion starts in the next biological interval.';
    this.log(c.effect,'accepted_effect',c.id,{event_id:e.id,transaction_id:plan.transaction_id,ready_at:plan.ready_at});
    if(acknowledge)this.kernel.acknowledge(e.id,receipt);
    return clone(receipt);
  }
  advanceOne(dt){
    assert(Number.isFinite(dt)&&dt>0&&dt<=1,'Biological step must be > 0 and <= 1 minute.');
    const snapshots=this.cells.filter(isEpi).map(c=>this.snapshot(c)),byId=new Map(snapshots.map(s=>[s.cell.id,s]));
    const {proposed,diagnostics}=this.collectProposals(snapshots,dt);
    const starts=[],rejections=[];
    for(const p of proposed){
      try{
        const event=this.kernel.start(p.action_id,byId.get(p.cell_id),{start_min:p.proposed_start_min,proposal:p});
        starts.push(event);this.totalDecisions++;
        this.log(`${p.action_id} initiated; ${event.duration_min.toFixed(1)} active min required.`,'initiation',p.cell_id,{time_min:event.started_at,event,snapshot:byId.get(p.cell_id),hazards:p.hazards});
      }catch(error){const rejection={proposal:p,reason:error.code??error.message};rejections.push(rejection);this.log('Proposed initiation rejected.','rejection',p.cell_id,rejection);}
    }
    const end=this.time_min+dt;
    // Start-of-interval sensed fields drive memory. Then deposit finite cellular
    // output and external sources, transport fields, and complete events at end.
    this.updateContinuous(dt);
    for(const source of this.sources){
      const elapsed=Math.max(0,Math.min(end,source.until)-Math.max(this.time_min,source.started_at));
      for(const [i,weight]of source.weights)this.fields.deposit(source.field,i,source.rate*elapsed*weight);
    }
    this.fields.advance(dt);this.time_min=end;this.tick++;this.revision++;
    for(const event of [...this.kernel.events.values()].filter(active).sort((a,b)=>a.started_at-b.started_at||a.id.localeCompare(b.id))){
      const before=event.status,c=this.cellById.get(event.cell_id);
      const committed=this.appliedTransactions.get(`${this.run_id}:${event.id}:complete`);
      if(committed){this.kernel.acknowledge(event.id,committed.receipt);continue;}
      if(this.time_min<event.started_at)continue;
      const outcome=this.kernel.advance(event.id,this.snapshot(c),this.time_min);
      if(outcome.transaction_id){
        try{this.commitCompletion({...outcome,run_id:this.run_id});}
        catch(error){this.log(`Completion pending: ${error.message}`,'pending_completion',c.id,{event_id:event.id,reason:error.message});}
      }else if(outcome.status!==before)this.log(`${event.action_id}: ${outcome.status}.`,'event_status',c.id,{event:outcome});
    }
    this.sources=this.sources.filter(s=>s.until>this.time_min);
    this.records.push({...this.epoch(),dt_min:dt,diagnostics,proposals:proposed,starts:starts.map(e=>e.id),rejections});
  }
  step(minutes=1){
    assert(Number.isFinite(minutes)&&minutes>0&&minutes<=60,'Advance between 0 and 60 biological minutes at a time.');
    let remaining=minutes;while(remaining>1e-10){const dt=Math.min(1,remaining);this.advanceOne(dt);remaining-=dt;}
    this.recordFrame();
  }
  advisoryBatch(){
    return prepareAdvisoryBatch(this.kernel,this.cells.filter(isEpi).map(c=>this.snapshot(c)),this.epoch()).batch;
  }
  acceptAdvisory(batch,response){
    const checked=validateCompleteChannelReply(batch,response,this.epoch());
    this.providerRequests.push({kind:'offline_advisory_validation',...this.epoch(),response:checked});return checked;
  }
  recordFrame(replace=false){
    const cells=this.cells.map(c=>{
      const snapshot=this.snapshot(c),events=[...this.kernel.events.values()].filter(e=>e.cell_id===c.id);
      const ongoing=events.filter(active),secreting=(c.lastCXCL8Flux??0)>0;
      return {...clone(c),manual:{snapshot,candidates:this.candidates(c,snapshot),events:clone(events),
        reservations:ongoing.flatMap(e=>e.reserved_costs.map(cost=>({...cost,event_id:e.id}))),
        preparing:ongoing.some(e=>e.action_id==='EPITHELIAL_CXCL8_INDUCTION'),secreting,
        mucus:this.fields.values.MUCUS[c.apical]??0,CXCL8:this.fields.values.CXCL8[c.basal]??0}};
    });
    const count=state=>cells.filter(c=>c.state.viability===state).length;
    this.metrics={alive:count('viable')+count('injured'),present:cells.filter(c=>c.state.viability!=='cleared').length,
      inTissue:cells.filter(c=>!c.reserve&&c.state.viability!=='cleared').length,reserve:cells.filter(c=>c.reserve).length,
      recruited:0,dead:count('dead_present'),extruded:0,cleared:count('cleared'),gaps:0,barrier:1,
      active:new Set([...this.kernel.events.values()].filter(active).map(e=>e.cell_id)).size,
      inflammation:0,byType:Object.fromEntries(Object.keys(TYPES).map(t=>[t,cells.filter(c=>c.type===t).length]))};
    const frame={...this.epoch(),mode:'manual',metrics:clone(this.metrics),cells,slots:clone(this.slots),sources:clone(this.sources),
      fields:this.fields.display(),fieldAccounting:this.fields.audit(),acceptedTransactions:this.appliedTransactions.size};
    if(replace&&this.history.at(-1)?.tick===this.tick)this.history[this.history.length-1]=frame;else this.history.push(frame);
    if(this.history.length>121)this.history.shift();
  }
  export(){
    return {application:'Cellville 3D',version:'3.5.0',...this.epoch(),mode:'manual',policy:this.policy,seed:this.seed,
      rule_version:registry.metadata.version,rule_sha256:this.manifest.rule_hash,host_manifest:this.manifest,coverage:manualCoverage(),
      resumable:false,replay:'Latest 121 retained visual frames. No API calls during replay.',
      rng:{algorithm:'Reference seededRandom',seed:this.seed,draws:this.rngDraws,tie_seed:(this.seed^0x54a92d73)>>>0,tie_draws:this.tieDraws},
      nextEventId:this.kernel.nextId,interventions:clone(this.interventions),records:clone(this.records),
      events:clone([...this.kernel.events.values()]),eventLog:clone(this.eventLog),transactions:clone([...this.appliedTransactions.entries()]),
      cells:clone(this.cells),metrics:clone(this.metrics),fields:Object.fromEntries(Object.entries(this.fields.values).map(([k,v])=>[k,Array.from(v)])),
      fieldAccounting:this.fields.audit(),providerRequests:clone(this.providerRequests),frames:clone(this.history),
      counters:{decisions:this.totalDecisions,apiCalls:this.apiCalls,inputTokens:this.apiTokens}};
  }
}
