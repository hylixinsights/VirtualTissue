import {Diorama} from './renderer.mjs';
import {decodeEpisode} from './episode.mjs';
const $=id=>document.getElementById(id);
let episode=null,index=0,selected=null,playing=false,previous=0;
const view=new Diorama($('world'),$('overlay'),p=>{if(p.cell!==undefined){selected=p.cell;view.selected=selected;inspect();}});view.options.faces=false;view.replay=true;
function inspect(choice=null){
 const f=episode?.frames[index],c=f?.cells.find(c=>c.id===selected);
 $('inspector').textContent=c?`${c.id} · ${c.state.type} · ${c.state.viability}\n\nLocal inputs at ${f.time_min} min:\n${JSON.stringify(c.unified.local,null,2)}\n\n${c.unified.reasons.join('; ')||'Within local baseline.'}`:'Click a cell to inspect its recorded local view.';
 const last=c?.unified.last,rounds=episode?.rounds.filter(r=>last&&(r.epoch.time_min<last.time_min||r.epoch.time_min===last.time_min&&r.epoch.revision<=last.revision)&&r.observations.some(o=>o.cell_id===selected))??[];
 const chosen=Number.isInteger(choice)&&choice>=0&&choice<rounds.length?choice:rounds.length-1,round=rounds[chosen],observation=round?.observations.find(o=>o.cell_id===selected),question=round?.request.cells.find(q=>q.id===c?.visualIndex),answer=question?round.response.decisions[question.id]:null;
 $('decisionHistory').replaceChildren(...rounds.map((r,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${r.epoch.time_min} min · ${r.response.decisions[c.visualIndex].action}`;return o;}));$('decisionHistory').disabled=!rounds.length;$('decisionHistory').value=chosen;
 $('decision').textContent=answer?`Recorded at ${round.epoch.time_min} min · ${round.response.meta.model}\n\n${JSON.stringify(answer,null,2)}`:'No decision had been recorded for this cell at this time.';
 $('constraints').textContent=observation?JSON.stringify(observation,null,2):'No decision snapshot for this cell yet.';
 $('effects').textContent=c?JSON.stringify(episode.transactions.filter(t=>t.plan.cell_id===c.id&&t.receipt.applied_at<=f.time_min),null,2):'Select a cell.';
}
function show(instant=true){const f=episode.frames[index];view.setFrame(f,instant);$('timeline').value=index;$('clock').textContent=`REPLAY · ${f.time_min} min`;$('barrier').textContent=`Barrier ${Math.round(f.metrics.barrier*100)}%`;$('activeHud').textContent=`${f.metrics.active} sensing change`;inspect();}
async function load(file){
 playing=false;$('play').textContent='Play';$('error').textContent='';
 try{const next=await decodeEpisode(await file.arrayBuffer());$('filename').textContent=file.name;episode=next;index=0;selected=null;view.selected=null;$('timeline').max=episode.frames.length-1;$('play').disabled=false;
  const m=episode.metadata;$('title').textContent=m.scenario?.title??'Recorded experiment';$('provenance').textContent=`${m.provider==='fixture'?'OFFLINE FIXTURE — not Jev-generated':'Recorded Jev responses'} · ${m.status} · ${m.duration_min} biological min · ${m.cell_questions} cell decisions · ${m.calls} original API calls. Playback uses zero API calls.${m.stop_reason?' Stopped: '+m.stop_reason:''}`;show();view.home();
 }catch(e){$('error').textContent=e.message;}
}
$('decisionHistory').onchange=()=>inspect(Number($('decisionHistory').value));
$('open').onclick=()=>$('file').click();
$('file').onchange=()=>{if($('file').files[0])load($('file').files[0]);};
$('play').onclick=()=>{if(!episode)return;if(index===episode.frames.length-1){index=0;show();}playing=!playing;$('play').textContent=playing?'Pause':'Play';previous=0;};
$('timeline').oninput=()=>{if(!episode)return;playing=false;$('play').textContent='Play';index=Number($('timeline').value);show();};
$('home').onclick=()=>view.home();$('front').onclick=()=>view.front();
function animate(now){if(episode)view.render(now);if(playing&&now-previous>1000/Number($('speed').value)){previous=now;if(index<episode.frames.length-1){index++;show(false);}else{playing=false;$('play').textContent='Play';}}requestAnimationFrame(animate);}requestAnimationFrame(animate);
window.VirtualTissuePlayer={load,get episode(){return episode;},get index(){return index;},view};
