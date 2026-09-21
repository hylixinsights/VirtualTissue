#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {UnifiedTissue} from '../src/unified-host.mjs';
import {ACTIVE_PACK,scenarioById} from '../src/tissue-pack.mjs';
import {EpisodeRecorder,encodeEpisode} from '../src/episode.mjs';
import {fixtureProvider} from '../src/fixture-provider.mjs';
const {values:o}=parseArgs({options:{provider:{type:'string'},scenarios:{type:'string',default:'etec,epec,ibd,baseline'},'duration-min':{type:'string'},'max-calls':{type:'string',default:'100'},'frame-interval':{type:'string',default:'5'},seed:{type:'string',default:'20260919'},server:{type:'string',default:'http://127.0.0.1:8000'},output:{type:'string',default:'recordings/runs'},help:{type:'boolean'}}});
if(o.help){console.log('node scripts/record_experiments.mjs --provider fixture|jev --scenarios etec,epec,ibd,baseline --max-calls 100 [--duration-min 180] [--server http://127.0.0.1:8000] [--output recordings/runs]\nEach scenario gets a fresh tissue. All tests use fixture; only --provider jev calls your local Jev server.');process.exit(0);}
if(!['fixture','jev'].includes(o.provider))throw Error('Choose explicitly: --provider fixture (no API) or --provider jev (paid live responses).');
const limit=Number(o['max-calls']),seed=Number(o.seed),interval=Number(o['frame-interval']);
if(!Number.isInteger(limit)||limit<1||limit>10000||!Number.isInteger(seed)||seed<0||seed>4294967295)throw Error('Invalid request limit or seed.');
const server=new URL(o.server);if(!['127.0.0.1','localhost'].includes(server.hostname)||server.protocol!=='http:')throw Error('Use the local HTTP Jev server.');
const scenarios=o.scenarios.split(',').map(id=>scenarioById(id));
for(const s of scenarios){if(o['duration-min'])s.duration_min=Number(o['duration-min']);if(!Number.isInteger(s.duration_min)||s.duration_min<1||s.duration_min>10080)throw Error('Duration must be 1–10080 minutes.');}
if(o.provider==='jev'){const r=await fetch(new URL('/api/status',server)),status=await r.json();if(!r.ok||!status.configured)throw Error('Configure your Jev key in the local server first.');if(status.packFingerprint!==ACTIVE_PACK.fingerprint)throw Error('Server and recorder use different tissue packs. Restart the server after build.py.');}
const output=resolve(o.output);await mkdir(output,{recursive:true});const index=[];
for(const scenario of scenarios){
 const t=new UnifiedTissue(seed),rec=new EpisodeRecorder(t,{scenario,provider:o.provider,duration_min:scenario.duration_min,frame_interval_min:interval});
 let status='complete',reason=null;
 const provider=o.provider==='fixture'?fixtureProvider:async request=>{
  const remaining=limit-t.apiCalls;if(remaining<=0)throw Error('Experiment request limit reached.');
  let r;try{r=await fetch(new URL('/api/cells/decide',server),{method:'POST',headers:{'Content-Type':'application/json',Origin:server.origin},body:JSON.stringify({...request,call_limit:remaining}),signal:AbortSignal.timeout(90000)});}catch(e){throw Error('Connection interrupted; usage may be unknown. '+e.message);}
  const body=await r.json();if(!r.ok){const e=Error(body.error??'Jev request failed.');e.meta=body.meta;throw e;}return body;
 };
 try{for(const input of scenario.inputs)t.inject(input.kind,input.x);while(t.time_min<scenario.duration_min){await t.advance(Math.min(5,scenario.duration_min-t.time_min),provider);if(t.time_min%30===0)console.log(`${scenario.id}: ${t.time_min}/${scenario.duration_min} min, ${t.decisions.length} cell decisions, ${t.apiCalls} API calls`);}}
 catch(e){status='partial';reason=e.message;console.error(`${scenario.id}: partial recording — ${reason}`);}
 const episode=rec.finish(status,reason),file=`${scenario.id}-${t.run_id}.vt.json.gz`;const encoded=await encodeEpisode(episode);await writeFile(resolve(output,file),encoded);
 index.push({file,...episode.metadata,bytes:encoded.byteLength});await writeFile(resolve(output,'index.json'),JSON.stringify(index,null,2)+'\n');
 console.log(`Saved ${file}: ${status}, ${t.time_min} min, ${t.decisions.length} cell decisions. Next scenario starts from a new tissue.`);
}
if(index.some(e=>e.status!=='complete'))process.exitCode=2;
