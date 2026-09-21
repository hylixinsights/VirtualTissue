/** Seeded mechanistic controls. Purely local; original reference files untouched. */
import {IleumTissue} from '../src/ileum-host.mjs';
import {ILEUM_MANIFEST} from '../src/ileum-parameters.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
const trials=[];
for(const kind of ['epec','epec_control','ileitis']){
 const t=new IleumTissue(20260919);t.inject(kind,.25);for(let i=0;i<10;i++)t.step(60);
 const physical={cells:t.cells,bacteria:t.lab.bacteria,patches:t.lab.patches,events:t.lab.events,audit:t.auditLab()};
 trials.push({scenario:kind,seed:t.seed,minutes:t.time_min,metrics:t.metrics,audit:t.auditLab(),
   events:Object.fromEntries([...new Set(t.lab.events.map(e=>e.action_id))].map(k=>[k,t.lab.events.filter(e=>e.action_id===k&&e.status==='acknowledged').length])),
   rng_draws:t.lab.draws,physics_sha256:createHash('sha256').update(JSON.stringify(physical)).digest('hex')});
}
const result={version:'3.3.0',extension:ILEUM_MANIFEST.version,evidence:'P',calibrated:false,api_calls:0,
 note:'600-minute illustrative experiments, not fitted clinical outcomes. Run IDs excluded. Water residual tolerance 1e-8; bacterial count residual exactly zero. Same seed/parameters reproduce within the same JS runtime.',trials};
if(process.argv[2]&&!process.argv[2].startsWith('--'))fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
if(process.argv.includes('--check')){
 const expected=JSON.parse(fs.readFileSync(new URL('../docs/ileum_reproduction.json',import.meta.url)));
 const compare=(a,b,path='result')=>{
  if(path.endsWith('.physics_sha256'))return; // hashes identify same-runtime runs; compare amounts numerically across engines
  if(typeof a==='number'&&typeof b==='number'){if(Math.abs(a-b)>1e-8)throw new Error(`Reproduction differs at ${path}: ${a} vs ${b}`);return;}
  if(a&&b&&typeof a==='object'&&typeof b==='object'){if(JSON.stringify(Object.keys(a))!==JSON.stringify(Object.keys(b)))throw new Error(`Reproduction keys differ at ${path}`);for(const k of Object.keys(a))compare(a[k],b[k],`${path}.${k}`);return;}
  if(a!==b)throw new Error(`Reproduction differs at ${path}`);
 };
 compare(result,expected);
}
console.log(JSON.stringify(result,null,2));
