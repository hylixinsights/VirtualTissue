import compiled from '../tissues/compiled-pack.json' with {type:'json'};
import {validateRegistry} from '../manual_v3/kernel.mjs';

export const ACTIVE_PACK=compiled;
export const ACTIVE_REGISTRY=compiled.registry;
export function validatePack(pack){
 if(pack?.format!=='virtualtissue.compiled-pack.v1'||pack.definition.host_adapter!=='ileum-cutaway-v1')throw new Error('Unsupported tissue adapter.');
 validateRegistry(pack.registry);
 if(!Array.isArray(pack.population)||pack.population.length<2||pack.population.length>500)throw new Error('Invalid population.');
 if(new Set(pack.population.map(c=>c.id)).size!==pack.population.length)throw new Error('Duplicate cell identity.');
 const injury=pack.definition.injury;
 if(!injury||!['radius','core_radius','peak_cell_damage','minimum_barrier_damage','DAMP_per_damage'].every(k=>Number.isFinite(injury[k])&&injury[k]>=0&&injury[k]<=1)||!(injury.core_radius<injury.radius&&injury.radius<=.5&&injury.peak_cell_damage>0&&injury.peak_cell_damage<1))throw new Error('Invalid injury parameters.');
 return pack;
}
export function scenarioById(id,pack=ACTIVE_PACK){
 const row=pack.scenarios.find(s=>s.id===id);
 if(!row)throw new Error(`Unknown scenario: ${id}`);
 return JSON.parse(JSON.stringify(row));
}
