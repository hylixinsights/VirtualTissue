// Portable data only. This module has no provider, network or simulation dependency.
const clone=v=>JSON.parse(JSON.stringify(v));
const bytes=s=>new TextEncoder().encode(s);
const ensure=(ok,message)=>{if(!ok)throw new Error(message);};
export const EPISODE_LIMIT=256*1024*1024;
export function compactFrame(frame){
 const f=clone(frame);
 for(const c of f.cells){delete c.manual.snapshot;delete c.observation;delete c.menu;delete c.weights;c.manual.events=c.manual.events.filter(e=>['running','paused','pending'].includes(e.status));}
 return f;
}
export class EpisodeRecorder {
 constructor(tissue,{scenario=null,provider='jev',duration_min=null,frame_interval_min=tissue.pack.definition.recording.frame_interval_min,max_bytes=tissue.pack.definition.recording.max_bytes}={}){
  ensure(tissue.time_min===0&&tissue.interventions.length===0,'Recording must start on a fresh tissue before any input.');
  ensure(['jev','fixture'].includes(provider),'Unknown recording provider.');
  ensure(Number.isInteger(frame_interval_min)&&frame_interval_min>=1&&frame_interval_min<=60,'Invalid frame interval.');
  this.tissue=tissue;this.limit=max_bytes;this.size=0;this.closed=false;
  this.data={format:'virtualtissue.episode.v1',metadata:{run_id:tissue.run_id,seed:tissue.seed,created_at:new Date().toISOString(),provider,scenario:clone(scenario),requested_duration_min:duration_min,frame_interval_min,status:'recording',pack_fingerprint:tissue.pack.fingerprint,integrity_note:'SHA-256 checks file integrity, not authorship or biological validation.'},pack:clone(tissue.pack),frames:[],rounds:[]};
  tissue.recorder=this;this.capture(tissue.history.at(-1),true);
 }
 check(){if(this.size>this.limit)throw new Error('Recording size limit reached. Save this partial experiment before starting another.');}
 capture(frame,force=false){
  if(this.closed)return;
  const prev=this.data.frames.at(-1);
  // Preserve time-zero baseline and post-input states as separate revisions.
  if(!force&&prev&&frame.time_min!==0&&frame.time_min-prev.time_min<this.data.metadata.frame_interval_min)return;
  if(prev&&prev.time_min===frame.time_min&&prev.revision===frame.revision&&(!force||JSON.stringify(prev)===JSON.stringify(compactFrame(frame))))return;
  const f=compactFrame(frame);this.data.frames.push(f);this.size+=bytes(JSON.stringify(f)).length;this.check();
 }
 decisionRound(plan,response){
  if(this.closed)return;
  if(response.meta?.fixture||/fixture/i.test(response.meta?.model??''))this.data.metadata.provider='fixture';
  const row={epoch:clone(plan.epoch),request:clone(plan.request),observations:plan.entries.filter(e=>e.eligible).map(e=>({cell_id:e.id,snapshot:clone(e.snapshot),eligibility:clone(e.rows)})),response:clone(response)};
  this.data.rounds.push(row);this.size+=bytes(JSON.stringify(row)).length;this.check();
 }
 finish(status='complete',reason=null){
  if(this.closed)return clone(this.data);
  ensure(['complete','partial'].includes(status),'Invalid completion status.');
  // Keep the final accepted state even if the stop was caused by a size limit.
  const limit=this.limit;this.limit=Infinity;this.tissue.recordFrame(true);this.capture(this.tissue.history.at(-1),true);this.limit=limit;
  const t=this.tissue;
  Object.assign(this.data,{decisions:clone(t.decisions),events:clone([...t.kernel.events.values()]),transactions:clone([...t.appliedTransactions.values()]),physical_events:clone(t.lab.events),interventions:clone(t.interventions),request_audit:clone(t.requestAudit),event_log:clone(t.eventLog),final_audit:clone(t.auditLab())});
  Object.assign(this.data.metadata,{status,stop_reason:reason,duration_min:t.time_min,calls:t.apiCalls,input_tokens:t.apiTokens,cell_questions:t.decisions.length,models:[...new Set(t.decisions.map(d=>d.model))]});
  this.closed=true;t.recorder=null;return clone(this.data);
 }
}
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(text))),b=>b.toString(16).padStart(2,'0')).join('');
export const encodeEpisode=async episode=>{
 validateEpisode(episode);
 const payload=JSON.stringify(episode);ensure(bytes(payload).length<EPISODE_LIMIT,'Episode exceeds the portable file limit.');
 const envelope=JSON.stringify({format:'virtualtissue.archive.v1',sha256:await digest(payload),payload});ensure(bytes(envelope).length<EPISODE_LIMIT,'Archive envelope exceeds the portable file limit.');
 return new Uint8Array(await new Response(new Blob([envelope]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
};
export function validateEpisode(e){
 ensure(e?.format==='virtualtissue.episode.v1'&&['complete','partial'].includes(e.metadata?.status),'Unsupported or unfinished episode.');
 ensure(e.pack?.definition?.renderer_adapter==='ileum-cutaway-v1'&&e.pack.fingerprint===e.metadata.pack_fingerprint,'Unsupported or mismatched tissue pack.');
 ensure(['jev','fixture'].includes(e.metadata.provider),'Missing decision provenance.');
 ensure(Array.isArray(e.frames)&&e.frames.length>0&&e.frames.length<=20000,'Invalid frame count.');
 let previous=-1;const ids=new Set(e.pack.population.map(c=>c.id));ensure(ids.size>=2&&ids.size<=500,'Invalid population.');
 for(const f of e.frames){ensure(f.time_min>=previous&&f.run_id===e.metadata.run_id&&f.cells?.length===ids.size,'Invalid frame sequence.');previous=f.time_min;
  ensure(new Set(f.cells.map(c=>c.id)).size===ids.size&&f.cells.every(c=>ids.has(c.id)&&c.manual&&c.unified&&c.v5),'Invalid recorded cell state.');
  ensure(f.fields&&f.lab&&f.metrics&&f.slots,'Incomplete visual frame.');
 }
 ensure(e.frames[0].time_min===0&&e.frames.at(-1).time_min===e.metadata.duration_min,'Recording endpoints are missing.');
 ensure(Array.isArray(e.rounds)&&Array.isArray(e.decisions)&&Array.isArray(e.transactions),'Missing decision audit.');
 for(const r of e.rounds){ensure(r.epoch?.run_id===e.metadata.run_id&&Array.isArray(r.request?.cells)&&Array.isArray(r.observations)&&r.response?.decisions,'Invalid decision round.');}
 ensure(e.decisions.length===e.metadata.cell_questions,'Decision count mismatch.');
 return e;
}
export const decodeEpisode=async input=>{
 ensure(input.byteLength<=EPISODE_LIMIT,'Compressed recording is too large.');
 const raw=new Uint8Array(input),gzip=raw[0]===31&&raw[1]===139;
 const stream=gzip?new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip')):new Blob([raw]).stream();
 const reader=stream.getReader(),parts=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>EPISODE_LIMIT){await reader.cancel();throw new Error('Expanded recording is too large.');}parts.push(value);}
 const joined=new Uint8Array(length);let off=0;for(const p of parts){joined.set(p,off);off+=p.length;}
 const parse=s=>JSON.parse(s,(k,v)=>{ensure(!['__proto__','prototype','constructor'].includes(k),'Unsafe data key.');ensure(typeof v!=='number'||Number.isFinite(v),'Nonfinite recorded value.');return v;});
 const envelope=parse(new TextDecoder().decode(joined));ensure(envelope.format==='virtualtissue.archive.v1'&&typeof envelope.payload==='string','Unsupported recording file.');
 ensure(await digest(envelope.payload)===envelope.sha256,'Recording checksum failed.');
 return validateEpisode(parse(envelope.payload));
};
export const saveEpisode=async episode=>{
 const blob=new Blob([await encodeEpisode(episode)],{type:'application/gzip'}),a=document.createElement('a'),url=URL.createObjectURL(blob);
 a.href=url;a.download=`${episode.metadata.scenario?.id??'experiment'}-${episode.metadata.run_id}.vt.json.gz`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
