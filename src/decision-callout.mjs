import {ILEUM_ACTIONS} from './ileum-parameters.mjs';
import {TYPES,ACTIONS,clamp} from './engine.mjs';

// Presentation only: read the displayed snapshot, including during replay.
const eventNames={EPITHELIAL_CXCL8_INDUCTION:'Prepare CXCL8 capacity',GOBLET_RELEASE:'Prepare mucus release'};
export function cellDecision(c,frame,replay=false){
 const model={name:`${TYPES[c.type].name} · ${c.id}`,clock:`${replay?'REPLAY':'LIVE'} · Cycle ${frame.tick}${frame.mode==='manual'?` · ${frame.time_min} min`:''}`,rows:[],note:''};
 if(c.unified){
  model.clock=`${replay?'REPLAY':'LIVE'} · ${frame.time_min} biological min`;
  if(c.v5)model.name=`${c.v5.phenotype.replaceAll('_',' ')} · ${c.id}`;
  const u=c.unified,events=c.manual.events.filter(e=>['running','paused','pending'].includes(e.status));
  model.rows.push({text:!c.alive?'Dead · awaiting clearance':c.state.viability==='death_committed'?'Committed death':u.active?`Detects ${u.reasons[0].toLowerCase()}`:'Within local baseline',tone:u.active?'preparing':'quiet'});
  for(const e of events)model.rows.push({text:e.action_id.replaceAll('_',' ').toLowerCase(),tone:'preparing',progress:clamp(e.active_elapsed_min/e.duration_min),detail:`${e.active_elapsed_min.toFixed(0)} / ${e.duration_min.toFixed(0)} biological min`});
  if(c.v5?.presented.length)model.rows.push({text:'Presenting acquired antigen',tone:'active'});
  if(c.v5?.phenotype==='resident_like')model.rows.push({text:'Adapted · monocyte origin retained',tone:'active'});
  if(c.manual.secreting)model.rows.push({text:'Secreting CXCL8',tone:'active'});
  model.note=u.last?`Jev · ${u.last.time_min} min · ${u.last.rejection?'choice not started':u.last.action.replaceAll('_',' ').toLowerCase()}`:u.active?'Waiting for an eligible cellular choice.':'No Jev question needed.';
  return model;
 }
 if(!c.alive){model.rows.push({text:'Cell removed',tone:'quiet'});return model;}
 if(!c.manual){
  const decided=c.lastDecisionTick!==null&&c.lastDecisionTick!==undefined;
  const cue=c.sensing?.activation;
  if(cue)model.rows.push({text:cue.active?`Detects: ${cue.reasons[0].label.toLowerCase()}${cue.reasons.length>1?` + ${cue.reasons.length-1} more`:''}`:'Within local baseline',tone:cue.active?'preparing':'quiet'});
  model.rows.push({text:decided?(ACTIONS[c.action]?.label??c.action):'Waiting for first decision',tone:decided?'active':'quiet'});
  model.note=decided?`${c.lastDecisionTick===frame.tick?'This cycle':`Last decision · cycle ${c.lastDecisionTick}`} · ${c.source} · ${c.effect}`:cue?.active?'Local change detected. Advance one cycle to execute a response.':'Routine maintenance only until a local cue is detected.';
  return model;
 }
 const m=c.manual,active=m.events.filter(e=>['running','paused','pending'].includes(e.status));
 for(const e of active){
  const progress=e.duration_min>0?clamp(e.active_elapsed_min/e.duration_min):0;
  model.rows.push({text:eventNames[e.action_id]??e.action_id,tone:e.status==='running'?'preparing':'quiet',progress,
   detail:`${e.status==='running'?'Preparing':e.status==='paused'?'Paused':'Awaiting acceptance'} · ${e.active_elapsed_min.toFixed(1)} / ${e.duration_min.toFixed(1)} active min`});
 }
 if(m.secreting)model.rows.push({text:'Secreting CXCL8 → basal',tone:'active'});
 if(!model.rows.length){
  const supported=['enterocyte','goblet'].includes(c.type);
  const eligible=m.candidates.some(row=>eventNames[row.action_id]&&row.allowed);
  model.rows.push({text:!supported?'No implemented host action':eligible?'Waiting for event initiation':'Waiting for eligible signals',tone:'quiet'});
 }
 const latest=m.events.filter(e=>e.status==='acknowledged').sort((a,b)=>b.acknowledged_at-a.acknowledged_at)[0];
 model.note=latest?`Last accepted · ${latest.acknowledged_at.toFixed(1)} min: ${latest.action_id==='GOBLET_RELEASE'?'mucus released apically':'CXCL8 capacity increased'}.`:
  ['enterocyte','goblet'].includes(c.type)?'Reference events use biological time.':'Visible in this reduced host; no decision is simulated.';
 if(c.lab){
  model.rows=model.rows.filter(row=>!['No implemented host action','Waiting for eligible signals'].includes(row.text));
  if(c.lab.event){const e=c.lab.event;model.rows.unshift({text:ILEUM_ACTIONS[e.action_id],tone:'preparing',progress:clamp(e.active_elapsed_min/e.duration_min),detail:`${e.active_elapsed_min.toFixed(1)} / ${e.duration_min} min · ${e.target_id??'boundary'}`});}
  else model.rows.unshift({text:['nk','fibroblast'].includes(c.type)?'Visible only in this innate experiment':c.lab.activity,tone:'quiet'});
  if(c.lab.last)model.note=`Last accepted · ${c.lab.last.time_min.toFixed(1)} min: ${ILEUM_ACTIONS[c.lab.last.action_id]}.`;
  else model.note='Ileum extension · P assumptions. Readings belong to the displayed cycle.';
 }
 return model;
}
