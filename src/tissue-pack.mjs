import compiled from '../tissues/compiled-pack.json' with {type:'json'};
import {validateRegistry} from '../manual_v3/kernel.mjs';

export const ACTIVE_PACK=compiled;
export const ACTIVE_REGISTRY=compiled.registry;
export function validatePack(pack){
 if(pack?.format!=='virtualtissue.compiled-pack.v1'||pack.definition.host_adapter!=='ileum-cutaway-v1')throw new Error('Unsupported tissue adapter.');
 validateRegistry(pack.registry);
 if(!Array.isArray(pack.population)||pack.population.length<2||pack.population.length>500)throw new Error('Invalid population.');
 if(new Set(pack.population.map(c=>c.id)).size!==pack.population.length)throw new Error('Duplicate cell identity.');
 return pack;
}
export function scenarioById(id,pack=ACTIVE_PACK){
 const row=pack.scenarios.find(s=>s.id===id);
 if(!row)throw new Error(`Unknown scenario: ${id}`);
 return JSON.parse(JSON.stringify(row));
}
