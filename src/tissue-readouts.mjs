// Read-only display helpers. Recorded states are the sole source of these values.
const bounded=v=>Math.max(0,Math.min(1,Number.isFinite(v)?v:0));
export const cellDamage=c=>bounded(c.state?.damage??(1-c.health/100));
export const barrierDamage=(frame,c)=>{const slot=frame.slots?.find(s=>s.cell===c.id);return slot?bounded(1-slot.junction):null;};
export const formatReading=(value,percent=false)=>!Number.isFinite(value)?'Not applicable':percent?`${(value*100).toFixed(1)}%`:value===0?'0':Math.abs(value)<.0001?value.toExponential(2):value.toFixed(4);
export function tissueReadouts(frame){
 const slots=frame.slots??[],cells=frame.cells??[];
 return {injured:slots.filter(s=>s.junction<.98).length,barrierDamage:Math.max(0,...slots.map(s=>bounded(1-s.junction))),cellDamage:Math.max(0,...cells.map(cellDamage)),LT:Math.max(0,...cells.map(c=>c.unified?.local?.LT??0)),ST:Math.max(0,...cells.map(c=>c.unified?.local?.ST??0)),etec:frame.lab?.bacteria.some(b=>b.species==='ETEC')??false};
}
export function signalExplanation(frame,signal='all'){
 const r=tissueReadouts(frame);
 if(signal==='LT'||signal==='ST'){
  if(r[signal]>0)return `${signal}: ${formatReading(r[signal])} NCU peak epithelial exposure. Colored rings mark recorded local exposure; field brightness is a display scale.${!frame.fields?.[signal]?' This older recording has no toxin field map.':''}`;
  return r.etec?`${signal} is still zero: ETEC must reach the epithelium and colonize before releasing toxin. Advance biological time; a paused or budget-limited run cannot progress.`:`${signal} is zero: this toxin is produced by ETEC. Tissue injury and EPEC do not introduce ${signal}.`;
 }
 if(signal==='BARRIER_DAMAGE')return `${r.injured} injured junctions; maximum barrier damage ${formatReading(r.barrierDamage,true)}. Red marks locate damaged junctions. Cell damage separately reports loss of cell health.`;
 if(signal==='CELL_DAMAGE')return `Maximum cell damage ${formatReading(r.cellDamage,true)}. This measures loss of cell health, separately from junction damage. Injury does not imply immediate cell death.`;
 if(signal==='DAMP')return 'DAMP is a local damage-signal proxy, separate from structural barrier damage. Direct tissue injury creates a local damage cue; cytokines still require cellular responses.';
 return `Barrier injury: ${r.injured} junctions. Maximum cell damage ${formatReading(r.cellDamage,true)}. LT/ST appear only after local ETEC colonization. Click a readout to inspect its most affected cell.`;
}
export function mostAffectedCell(frame,signal){
 const score=c=>signal==='BARRIER_DAMAGE'?(barrierDamage(frame,c)??-1):signal==='CELL_DAMAGE'?cellDamage(c):(c.unified?.local?.[signal]??0);
 return [...frame.cells].sort((a,b)=>score(b)-score(a))[0];
}
