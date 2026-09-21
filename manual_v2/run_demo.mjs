/** One cell integration smoke demonstration. No tissue or clinical prediction. */
import fs from 'node:fs';
import { RuleKernel, readPath, writePath, boundedFlux } from './virtual_tissue_kernel.mjs';
const r=JSON.parse(fs.readFileSync(new URL('./virtual_tissue_rules_v2.json',import.meta.url)));
const s=JSON.parse(fs.readFileSync(new URL('./example_snapshot.json',import.meta.url)));
const k=new RuleKernel(r,{seed:21,capabilities:[...r.host_contract.required_for_any_execution,'field_transport']});
const log=[];let secreted=0;
// Only the supported induction rule can act. All absent host modules stay blocked.
for(let tick=0;tick<600;tick++){
 s.tick=tick;s.time_min=tick;
 for(const p of k.plan(s,1)){
   const e=k.start(p.action_id,s,{start_min:p.proposed_start_min,proposal:p});
   log.push({kind:'started',action:e.action_id,time:e.started_at,duration:e.duration_min});
 }
 s.time_min=tick+1;
 for(const e of k.activeEvents(s.cell.id)){
   const out=k.advance(e.id,s,s.time_min);
   if(!out.transaction_id)continue;
   // The tiny demonstration host only accepts cell assignments, never absent physical effects.
   if(out.effects.some(x=>x.op!=='set'))throw new Error('Demo host cannot execute physical intents');
   const next=structuredClone(s);
   for(const c of out.reserved_costs){const available=readPath(next,c.path);if(available<c.amount)throw new Error('Insufficient inventory at commit');writePath(next,c.path,available-c.amount);}
   for(const effect of out.effects)writePath(next,effect.path,effect.value);
   next.revision=s.revision+1;
   Object.assign(s,next);
   k.acknowledge(e.id,{transaction_id:out.transaction_id,committed:true,next_revision:s.revision,applied_at:s.time_min});
   log.push({kind:'completed',action:out.action_id,time:s.time_min});
 }
 // Explicit external substrate supply is fixed for this arithmetic demonstration.
 const capacity=s.cell.outputs.CXCL8 ?? 0;
 const flux=boundedFlux(r.parameters.output_rate.value,capacity,1,.002);
 secreted+=flux.amount;
 s.cell.outputs.CXCL8=capacity*Math.exp(-r.parameters.soluble_output_decay.value);
}
const result={description:'Single cell event and finite flux smoke demonstration, not a simulated tissue',biological_time_minutes:600,total_normalized_CXCL8_amount:secreted,events:log,final_cell:s.cell,software_only:true};
fs.writeFileSync(new URL('./demo_trace.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({events:log,total_normalized_CXCL8_amount:secreted},null,2));
