import {barrierDamage,formatReading,tissueReadouts,signalExplanation,mostAffectedCell} from './tissue-readouts.mjs';
import {UnifiedTissue,parsePerturbation,HOST_ACTIONS,actionLabel} from './unified-host.mjs';
import {ACTIVE_PACK,scenarioById} from './tissue-pack.mjs';
import {EpisodeRecorder,saveEpisode} from './episode.mjs';
import {Diorama} from './renderer.mjs';
import {TYPES,clamp} from './engine.mjs';
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v]));
let tissue=new UnifiedTissue(),selected=null,replayIndex=null,scenario=null,busy=false,playing=false,renderPaused=false,status={configured:false},lastUpdate=0,inspectIndex=0,arrival=null;
let recorder=new EpisodeRecorder(tissue,{duration_min:180}),recordingEnded=false,targetMinutes=180,callLimit=100;
const view=new Diorama($('world'),$('overlay'),p=>{if(p.cell!==undefined)select(p.cell);});view.options.faces=false;view.options.signals='all';
const displayed=()=>tissue.history[replayIndex??tissue.history.length-1];
const elapsed=n=>n>=1440?`${Math.floor(n/1440)} d ${Math.floor(n%1440/60)} h`:n>=60?`${Math.floor(n/60)} h ${n%60} min`:`${n} min`;
function showError(message=''){ $('errorBox').hidden=!message;$('errorBox').textContent=message; }
function select(id){selected=id;view.selected=id;inspect();}
function stop(){playing=false;$('playBtn').textContent='Run';}
function controls(){
 for(const id of ['resetBtn','applyBtn','stepBtn','position','promptBox','historySlider'])$(id).disabled=busy||(id==='applyBtn'&&(!scenario?.valid||replayIndex!==null))||(id==='stepBtn'&&(replayIndex!==null||tissue.interventions.length===0));
 $('applyBtn').textContent=busy?'Cells are responding…':'Introduce & run';
 $('playBtn').textContent=playing?'Pause':'Run';$('playBtn').disabled=recordingEnded;
 for(const id of ['stepBtn','applyBtn'])if(recordingEnded)$(id).disabled=true;
 for(const id of ['startRecording','exportBtn','discardBtn'])$(id).disabled=busy;
 for(const id of ['scenarioSelect','durationInput','callLimitInput'])$(id).disabled=busy||tissue.time_min>0||tissue.interventions.length>0;
 $('recordingStatus').textContent=recordingEnded?`Recording ${recorder.data.metadata.status} · ${tissue.time_min} min · ${tissue.decisions.length} individual decisions. Save the file, then reset for the next scenario.`:`Recording from 0 min · ${recorder.data.frames.length} saved frames · ${recorder.data.rounds.length} complete decision rounds · target ${targetMinutes} min · limit ${callLimit} API calls`;
}
async function connection(){
 if(location.protocol==='file:'){
  status={configured:false};$('connectionTitle').textContent='Open the local launcher to use Jev';$('connectionText').textContent='You opened the HTML file directly. Close this tab and double-click “Start Cellville.command” in VirtualTissue. It opens this tissue with the local Jev connection. You can inspect the scene here, but cellular decisions need that server.';
 }else{
  try{const r=await fetch('/api/status');if(!r.ok)throw new Error('status');status=await r.json();}
  catch{status={configured:false};}
  $('connectionTitle').textContent='Connect Jev before running cellular responses';$('connectionText').textContent='Start the local launcher and enter your TypeSafe API key in its hidden terminal prompt, or configure TYPESAFE_API_KEY on the server. Then check the connection here. There is no substitute decision provider.';
 }
 $('connectionPanel').hidden=!!status.configured;$('connectionBadge').textContent=status.configured?'Jev configured · individual cells':'Jev connection needed';$('connectionBadge').classList.toggle('ready',!!status.configured);
 $('serverStatus').textContent=status.configured?`Key configured in the local server · ${status.model}. No model request is made by this check.`:'Jev is not connected. Follow the connection instructions above the tissue.';
}
function preview(fromPosition=false){
 scenario=parsePerturbation($('promptBox').value);
 if(scenario.valid){if(fromPosition)scenario.x=Number($('position').value)/100;else $('position').value=String(scenario.x*100);$('previewText').textContent=`Ready to introduce: ${scenario.description}`;}
 else $('previewText').textContent=scenario.error;
 $('positionLabel').textContent=`${$('position').value}%`;controls();
}
async function provider(request){
 if(!status.configured)throw new Error('A cell is ready to choose, but Jev is not connected. Connect the local server, then press Run to continue from this exact time.');
 if(tissue.apiCalls>=callLimit)throw new Error('Experiment request limit reached. Save this partial recording or start a new experiment.');
 if(status.packFingerprint!==ACTIVE_PACK.fingerprint)throw new Error('Tissue pack mismatch. Rebuild the application and restart the server.');
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),60000);
 try{const response=await fetch('/api/cells/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,call_limit:callLimit-tissue.apiCalls}),signal:abort.signal});const body=await response.json();if(!response.ok){const e=new Error(body.error??'Jev request failed.');e.meta=body.meta;throw e;}return body;}
 finally{clearTimeout(timer);}
}
async function step(minutes=5){
 if(busy||replayIndex!==null||recordingEnded)return;minutes=Math.min(minutes,targetMinutes-tissue.time_min);if(minutes<=0){finishRecording('complete');return;}busy=true;controls();showError('');
 try{await tissue.advance(minutes,provider,()=>{view.setFrame(displayed());update();});if(tissue.time_min>=targetMinutes)finishRecording('complete');}
 catch(e){finishRecording('partial',e.message);showError(e.name==='AbortError'?'Jev timed out. The current decision round was not applied; request usage may be unknown.':e.message);}
 finally{busy=false;controls();update();}
}
async function apply(){
 if(busy||!scenario?.valid||replayIndex!==null)return;
 stop();showError('');if(tissue.time_min===0&&!tissue.interventions.length){
  const duration=Number($('durationInput').value),limit=Number($('callLimitInput').value);
  if(!Number.isInteger(duration)||duration<1||duration>10080||!Number.isInteger(limit)||limit<1||limit>10000){showError('Use 1–10080 biological minutes and 1–10000 API calls.');return;}
  targetMinutes=duration;callLimit=limit;recorder.data.metadata.requested_duration_min=duration;
 }if(!tissue.interventions.length)recorder.data.metadata.scenario={id:'custom',title:scenario.title,prompt:$('promptBox').value,inputs:scenario.kinds.map(kind=>({kind,x:scenario.x}))};tissue.applyPrompt(scenario);arrival={title:scenario.title,x:scenario.x,start:performance.now()};view.arrival=arrival;view.setFrame(displayed(),true);view.home();
 const directInjury=scenario.kinds.includes('injury');
 const first=directInjury?mostAffectedCell(displayed(),'CELL_DAMAGE'):displayed().cells.find(c=>c.unified.active);
 if(directInjury){$('signalSelect').value='CELL_DAMAGE';view.options.signals='CELL_DAMAGE';view.fieldKey='';if(first)view.focus(first);}
 select(first?.id??null);update();
 if(status.configured){playing=true;controls();await step(1);}else{showError('Perturbation introduced and visible. Connect Jev above, then press Run for cellular responses.');await connection();}
}
function update(){
 const f=displayed(),m=f.metrics,a=f.lab.audit,r=tissueReadouts(f);
 $('barrierDamageValue').textContent=`${formatReading(r.barrierDamage,true)} · ${r.injured} junctions`;$('cellDamageValue').textContent=formatReading(r.cellDamage,true);$('ltValue').textContent=formatReading(r.LT);$('stValue').textContent=formatReading(r.ST);$('signalNote').textContent=signalExplanation(f,view.options.signals);
 $('clock').textContent=`${replayIndex===null?'LIVE':'REPLAY'} · ${elapsed(f.time_min)}`;$('barrier').textContent=`Barrier ${Math.round(m.barrier*100)}%`;$('activeHud').textContent=`${m.active} sensing change`;$('preparingHud').textContent=`${m.preparing} preparing`;
 const species=[...new Set(f.lab.bacteria.filter(b=>['free','attached'].includes(b.state)).map(b=>b.species??'EPEC'))].join(' + '),liveBacteria=a.bacteria.free+a.bacteria.attached,hasInput=liveBacteria||m.barrier<.999;
 $('sceneTitle').textContent=liveBacteria?'Pathogen in the tissue':m.barrier<.999?'Local barrier injury':'Steady state';
 $('sceneText').textContent=liveBacteria?`${species} present. Cyan rods: ETEC; orange rods: EPEC. Amber rings: local sensing. Green dots: actual secretion.`:m.barrier<.999?'Red junction marks locate the barrier injury. Responses begin only where cells detect local cues.':'No local activation cue is present. Routine transport and maintenance continue.';
 $('introduced').textContent=liveBacteria?`${a.bacteria.free} free · ${a.bacteria.attached} attached ${species}`:f.unified.prompt?.title??'Nothing yet';
 $('detected').textContent=`${m.active} sensing change · ${m.quiet} within baseline`;
 const ongoing=f.cells.flatMap(c=>c.manual.events.filter(e=>['running','paused','pending'].includes(e.status))),completed=f.acceptedTransactions;
 $('responses').textContent=`${m.preparing} cells preparing · ${completed} completed effects`;
 $('consequences').textContent=`CXCL8 ${f.fieldAccounting.CXCL8.present.toFixed(3)} NAU · water ${a.water.retained.toFixed(2)} NWU`;
 let explanation=!hasInput&&!ongoing.length?'Introduce a perturbation to leave steady state.':ongoing.length?`Biological clocks are running: ${ongoing.length} processes. First completion in ~${Math.ceil(Math.min(...ongoing.map(e=>e.duration_min-e.active_elapsed_min)))} min.`:m.active?`${m.active} cells detect local change. The manual determines which can start an action.`:'The perturbation is present; waiting for local contact or a detectable signal.';
 if(busy)explanation='Advancing biological time and consulting Jev for eligible individual cells… '+explanation;
 $('progressText').textContent=explanation;
 $('inspectBtn').disabled=!f.cells.some(c=>c.unified.active||c.manual.preparing);
 $('historySlider').max=String(tissue.history.length-1);$('historySlider').value=String(replayIndex??tissue.history.length-1);
 $('usageText').textContent=`${tissue.decisions.length} individual cell questions answered · ${tissue.apiCalls} API calls · ${tissue.apiTokens} input tokens`;
 $('feed').innerHTML=tissue.eventLog.filter(e=>e.time_min<=f.time_min).slice(-12).reverse().map(e=>`<p><time>${elapsed(e.time_min)}${e.cell?' · '+esc(e.cell):''}</time>${esc(e.text)}</p>`).join('');
 const moving=f.cells.filter(c=>c.manual.events.some(e=>e.status==='running'&&e.action_id.endsWith('CHEMOTAXIS'))).length;
 const adapting=f.cells.filter(c=>c.manual.events.some(e=>['running','paused'].includes(e.status)&&e.action_id==='MYELOID_ADAPTATION')).length;
 const processing=f.cells.filter(c=>c.manual.events.some(e=>['running','paused'].includes(e.status)&&e.action_id==='DC_ANTIGEN_PROCESSING')).length;
 $('movementCount').textContent=`${f.v5.distance_um.toFixed(0)} µm · ${moving} moving`;
 $('deathCount').textContent=`${f.cells.filter(c=>isEpithelial(c)&&!c.alive).length} lost · ${f.cells.filter(c=>isEpithelial(c)&&c.state.viability==='death_committed').length} committed`;
 $('adaptationCount').textContent=`${adapting} adapting · ${f.v5.adapted} adapted`;
 $('antigenCount').textContent=`${processing} processing · ${f.v5.presenting} presenting`;
 inspect();controls();
}
const isEpithelial=c=>['enterocyte','goblet'].includes(c.type);
function inspect(){
 const f=displayed(),c=f.cells.find(c=>c.id===selected);
 if(!c){$('cellName').textContent='Select a cell';$('cellIdentity').textContent='Click a cell or Inspect responding cell to follow an individual response.';$('localState').textContent='Every cell has its own local view.';$('readings').innerHTML='';$('cellFate').innerHTML='';$('decisionTitle').textContent='No cell selected';$('decisionText').textContent='A local cue must appear before a cell is activated.';for(const id of ['eventProgress','allowedActions','blockedActions'])$(id).innerHTML='';$('probabilities').textContent='No model response recorded.';return;}
 const u=c.unified,last=u.last,ongoing=c.manual.events.filter(e=>['running','paused','pending'].includes(e.status));
 $('cellName').textContent=c.v5?.phenotype==='resident_like'?'Monocyte-derived macrophage':c.state.type==='dendritic'?'Dendritic cell':c.state.type==='inflammatory_monocyte'?'Monocyte':TYPES[c.type].name;$('cellIdentity').textContent=`${c.id} · ${c.state.type.replaceAll('_',' ')} · ${c.reserve?'vascular reserve':'tissue'}`;
 $('localState').textContent=!c.alive?'Dead cell · awaiting physical clearance':c.state.viability==='death_committed'?'Death committed · execution clock running':u.active?`Detects: ${u.reasons.join(' · ')}`:'Within baseline: no nearby activation cue.';$('localState').classList.toggle('quiet',!u.active);
 const labels={damage:'Cell damage',barrier_damage:'Barrier damage',LT:'LT · local apical',ST:'ST · local apical',DAMP:'DAMP · damage signal'};
 $('readings').innerHTML=Object.entries({...u.local,barrier_damage:barrierDamage(f,c)}).map(([k,v])=>`<div><span>${esc(labels[k]??k)}</span><strong>${k==='pathogens'?v:formatReading(v,['damage','barrier_damage'].includes(k))}</strong></div>`).join('');
 $('cellFate').innerHTML=`<strong>${esc(c.state.viability.replaceAll('_',' '))} · health ${c.health.toFixed(1)}%</strong><p>${c.v5.distance_um.toFixed(1)} µm traveled · ${c.v5.antigens.length} antigen source(s) acquired · ${c.v5.presented.length} presented</p><p>Origin: ${esc(c.v5.origin.replaceAll('_',' '))}. ${c.v5.phenotype==='resident_like'?'Adapted to resident-like state; origin preserved.':c.state.type==='inflammatory_monocyte'?'Adaptation requires recruitment and sustained low alarm; allow days.':c.state.type==='dendritic'?'Surface antigen display follows actual uptake and processing. This tissue has no T-cell priming circuit.':isEpithelial(c)?`Manual death commitment requires ≥75% damage, then its own preparation clock.`:''}</p>`+(c.v5.presented.length?`<p class="presented">Presenting: ${c.v5.presented.map(a=>esc(a.source+' · '+a.id)).join(', ')}</p>`:'');
 $('decisionTitle').textContent=ongoing.length?`Preparing: ${actionLabel(ongoing[0].action_id)}`:last?`Jev chose: ${actionLabel(last.action)}`:u.active?'Local change detected':'Steady state';
 $('decisionText').textContent=last?`${last.model} · ${last.time_min} min. ${last.rejection?'Not started: '+last.rejection+'. ':''}${c.effect}`:u.active?'The manual is checking local inputs, resources and action eligibility. No Jev choice has been recorded yet.':'No Jev question is needed while this cell remains within its local baseline.';
 $('eventProgress').innerHTML=ongoing.map(e=>`<div class="eventLabel">${esc(actionLabel(e.action_id))} · ${e.active_elapsed_min.toFixed(0)} / ${e.duration_min.toFixed(0)} min</div><div class="progress"><i style="width:${clamp(e.active_elapsed_min/e.duration_min)*100}%"></i></div>`).join('');
 const rows=c.manual.candidates;
 $('allowedActions').innerHTML=rows.filter(r=>r.allowed).map(r=>`<div class="action">${esc(actionLabel(r.action_id))}</div>`).join('')||'<p class="muted">No new action passes all gates right now. Ongoing processes retain their biological clocks.</p>';
 if(u.active)$('allowedActions').innerHTML+='<div class="action">Keep observing</div>';
 $('blockedActions').innerHTML=rows.filter(r=>!r.allowed).map(r=>`<div class="action blocked">${esc(actionLabel(r.action_id))}<small>${r.reasons.map(s=>esc(s.replaceAll('_',' ').toLowerCase())).join(' · ')}</small></div>`).join('');
 $('probabilities').innerHTML=last?`<p>Actual Jev distribution at ${last.time_min} min. These are model choice probabilities, not biological event rates.</p>`+Object.entries(last.weights).map(([a,p])=>`<div class="action">${esc(actionLabel(a))} <strong>${(p*100).toFixed(1)}%</strong></div>`).join(''):'No model response recorded.';
}
function finishRecording(state,reason=null){stop();if(recordingEnded)return;recorder.finish(state,reason);recordingEnded=true;controls();}
function reset(){if(busy)return;if(!recordingEnded&&(tissue.time_min||tissue.interventions.length)){showError('Save this recording before resetting, or use Discard & reset.');return;}resetFresh();}
function resetFresh(){if(busy)return;stop();replayIndex=null;selected=null;tissue=new UnifiedTissue(Number($('seedInput').value)>>>0);recorder=new EpisodeRecorder(tissue);recordingEnded=false;targetMinutes=Number($('durationInput').value)||180;callLimit=Number($('callLimitInput').value)||100;view.selected=null;view.arrival=null;view.setFrame(displayed(),true);view.home();showError('');update();}
function inspectResponding(){const cells=displayed().cells.filter(c=>c.manual.preparing||c.unified.active);if(cells.length){const c=cells[inspectIndex++%cells.length];select(c.id);view.focus(c);}}
$('promptBox').oninput=()=>preview();$('position').oninput=()=>preview(true);$('applyBtn').onclick=apply;
for(const b of document.querySelectorAll('[data-prompt]'))b.onclick=()=>{if(busy)return;$('promptBox').value=b.dataset.prompt;preview();$('promptBox').focus();};
$('playBtn').onclick=()=>{if(playing)stop();else{if(replayIndex!==null){replayIndex=null;view.replay=false;view.setFrame(displayed(),true);}if(!status.configured){showError('Connect Jev above before running the tissue.');connection();return;}playing=true;controls();lastUpdate=0;}};
$('stepBtn').onclick=()=>step(5);$('resetBtn').onclick=reset;$('inspectBtn').onclick=inspectResponding;
$('homeBtn').onclick=()=>view.home();$('frontBtn').onclick=()=>view.front();$('zoomIn').onclick=()=>view.zoom=clamp(view.zoom*1.2,.72,2.7);$('zoomOut').onclick=()=>view.zoom=clamp(view.zoom/1.2,.72,2.7);
$('focusBtn').onclick=()=>{const c=displayed().cells.find(c=>c.id===selected);if(c)view.focus(c);};
$('signalSelect').onchange=()=>{view.options.signals=$('signalSelect').value;view.fieldKey='';update();};
$('historySlider').oninput=()=>{if(busy)return;stop();replayIndex=Number($('historySlider').value);view.replay=true;view.arrival=null;view.setFrame(displayed(),true);update();};
$('liveBtn').onclick=()=>{if(busy)return;replayIndex=null;view.replay=false;view.setFrame(displayed(),true);update();};
$('exportBtn').onclick=async()=>{if(busy)return;try{finishRecording(tissue.time_min>=targetMinutes?'complete':'partial',tissue.time_min>=targetMinutes?null:'Stopped by user');await saveEpisode(recorder.data);showError('');}catch(e){showError(e.message);}};
$('discardBtn').onclick=()=>{if(!busy)resetFresh();};
$('scenarioSelect').innerHTML=ACTIVE_PACK.scenarios.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
$('scenarioSelect').onchange=()=>{$('durationInput').value=scenarioById($('scenarioSelect').value).duration_min;};
$('startRecording').onclick=async()=>{
 if(busy)return;
 if(tissue.time_min||tissue.interventions.length){showError('Save the current recording, then choose Discard & reset before starting another.');return;}
 const duration=Number($('durationInput').value),limit=Number($('callLimitInput').value);
 if(!Number.isInteger(duration)||duration<1||duration>10080||!Number.isInteger(limit)||limit<1||limit>10000){showError('Use 1–10080 biological minutes and 1–10000 API calls.');return;}
 resetFresh();const preset=scenarioById($('scenarioSelect').value);recorder.data.metadata.scenario=preset;recorder.data.metadata.requested_duration_min=duration;
 for(const input of preset.inputs)tissue.inject(input.kind,input.x);
 view.setFrame(displayed(),true);update();playing=true;await step(1);
};
$('settingsBtn').onclick=()=>{$('settingsDialog').showModal();connection();};
for(const id of ['manualBtn','aboutBtn'])$(id).onclick=()=>$('manualDialog').showModal();
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
$('refreshConnection').onclick=connection;
for(const [id,key]of [['facesToggle','faces'],['labelsToggle','labels'],['actionsToggle','actions'],['motionToggle','reduced']])$(id).onchange=()=>view.options[key]=$(id).checked;
$('motionToggle').checked=view.options.reduced;
const identities=[...Object.entries(TYPES).map(([type,t])=>({type:type==='macrophage'?'resident_macrophage':type,name:type==='macrophage'?'Resident macrophage':t.name,color:t.color})),{type:'inflammatory_monocyte',name:'Monocyte',color:'#D3A277'},{type:'dendritic',name:'Dendritic cell',color:'#68B6B4'}];
$('legend').innerHTML=identities.map(t=>`<button data-cell-type="${t.type}"><i style="background:${esc(t.color)}"></i>${esc(t.name)}</button>`).join('');
for(const b of $('legend').querySelectorAll('button'))b.onclick=()=>{const c=displayed().cells.find(c=>c.state.type===b.dataset.cellType&&c.alive);if(c){select(c.id);view.focus(c);}};
$('rulebook').innerHTML=identities.map(t=>`<div class="ruleType"><h3>${esc(t.name)}</h3><p>${tissue.registry.cell_types[t.type].allowed_actions.filter(a=>HOST_ACTIONS.includes(a)).map(a=>esc(actionLabel(a))).join(' · ')}</p></div>`).join('');
view.setFrame(displayed(),true);update();connection();
window.Cellville={version:'6.1.1',get tissue(){return tissue;},get recorder(){return recorder;},view,step,apply,preview,select,reset,stop,get busy(){return busy;},get playing(){return playing;},setRenderPaused(v){renderPaused=v;}};
function frame(now){if(!renderPaused)view.render(now);if(playing&&!busy&&now-lastUpdate>1000){lastUpdate=now;step(Number($('speedSelect').value));}requestAnimationFrame(frame);}requestAnimationFrame(frame);

for(const b of document.querySelectorAll('[data-track]'))b.onclick=()=>{
 const kind=b.dataset.track,f=displayed(),rows=f.cells.filter(c=>kind==='movement'?['neutrophil','inflammatory_monocyte'].includes(c.state.type):kind==='death'?isEpithelial(c):kind==='adaptation'?c.v5.origin==='inflammatory_monocyte':c.state.type==='dendritic');
 rows.sort((a,b)=>Number(b.manual.preparing)-Number(a.manual.preparing)||(kind==='death'?a.health-b.health:kind==='antigen'?b.v5.presented.length-a.v5.presented.length:b.v5.distance_um-a.v5.distance_um));
 if(rows.length){select(rows[0].id);view.focus(rows[0]);}
 $('processNote').textContent={movement:'Trails record actual displacement after Jev-selected motility. Neutrophils follow local CXCL8; monocytes follow CCL2. Resident macrophages are not assigned an invented chemotaxis program.',death:'Local injury accumulates. At ≥75% damage the manual can permit commitment; execution then follows automatically. Corpses remain visible until clearance. Infection alone does not guarantee death.',adaptation:'Recruited monocytes can adapt under sustained low alarm and permissive local context. The manual clock spans 1–7 biological days, and pauses if inflammation returns. Origin is preserved.',antigen:'Dendritic processes sample nearby bacteria. Only acquired antigen can enter processing and appear on the surface. Surface presentation does not mean a T cell has been activated.'}[kind];
};

for(const b of document.querySelectorAll('[data-readout]'))b.onclick=()=>{const key=b.dataset.readout;$('signalSelect').value=key;view.options.signals=key;view.fieldKey='';const c=mostAffectedCell(displayed(),key);if(c){select(c.id);view.focus(c);}update();};
