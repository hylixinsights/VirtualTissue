const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base=(process.env.SITE_URL||'http://127.0.0.1:8021').replace(/\/$/,'');
const captureDir=join(tmpdir(),'virtualtissue-portal-review');await mkdir(captureDir,{recursive:true});
const browser=await chromium.launch({channel:process.env.CI?undefined:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
await page.goto(base+'/');await page.locator('.tissue-card').last().scrollIntoViewIfNeeded();await page.screenshot({path:join(captureDir,'tissues.png'),fullPage:true});
await page.locator('.tissue-card .button[href="gut/"]').click();if(new URL(page.url()).pathname!=='/gut/')throw Error('Gut route');
await page.locator('.episode-launch').first().click();await page.waitForFunction(()=>window.VirtualTissuePlayer?.episode);if(await page.evaluate(()=>VirtualTissuePlayer.episode.metadata.scenario.id)!=='etec')throw Error('Legacy Gut replay');
await page.goto(base+'/');await page.locator('.tissue-card .button[href="lymph-node/"]').click();await page.locator('#loading').waitFor({state:'hidden',timeout:60000});
await page.getByRole('button',{name:/Plasmablast ·/}).click();if(Number(await page.locator('#decisions').textContent())<=0)throw Error('Recorded Jev decisions');
await page.getByRole('button',{name:/First IgM ·/}).click();if(Number(await page.locator('#antibodies').textContent())<=0)throw Error('IgM output');
await page.getByRole('button',{name:/First division ·/}).click();if(await page.locator('#divisions').textContent()!=='1')throw Error('Division');
await page.screenshot({path:join(captureDir,'lymph-node.png'),fullPage:true});await page.goto(base+'/');if(new URL(page.url()).pathname!=='/')throw Error('Return to portal');
for(const width of [768,390,320]){await page.setViewportSize({width,height:1000});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Portal overflow '+width);}
const forbidden=requests.filter(r=>r.method!=='GET'||new URL(r.url).origin!==new URL(base).origin||/\/api\//.test(r.url));
console.log({gutNavigation:true,legacyReplay:true,lnNavigation:true,lnIgM:true,lnDivisions:1,returnToPortal:true,errors,forbidden});if(errors.length||forbidden.length)throw Error('Portal failures');await browser.close();
