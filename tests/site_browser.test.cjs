// Run against: python3 -m http.server 8080 --directory site
// Requires Playwright; CHROMIUM_PATH can select a locally installed Chrome.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const base=process.env.SITE_URL||'http://127.0.0.1:8080';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const errors=[],requests=[],failures=[];
 const context=await browser.newContext({viewport:{width:1440,height:1050}});
 context.on('page',page=>{page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)failures.push(response.url());});});
 context.on('request',request=>requests.push({url:request.url(),method:request.method()}));
 try{
 const page=await context.newPage();
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'site/episodes/index.json')));
 for(const entry of catalog){
  const id=entry.scenario.id;
  await page.goto(`${base}/player.html?recording=${id}`);
  await page.waitForFunction(()=>window.VirtualTissuePlayer?.episode,{},{timeout:60000});
  assert.equal(await page.evaluate(()=>VirtualTissuePlayer.episode.metadata.scenario.id),id);
  assert.match(await page.locator('#provenance').innerText(),/OFFLINE FIXTURE/);
  assert.equal(await page.evaluate(()=>typeof window.Cellville),'undefined');
  await page.locator('#speed').selectOption('10');await page.locator('#play').click();
  await page.waitForFunction(()=>VirtualTissuePlayer.index>=2);await page.locator('#play').click();
  await page.locator('#timeline').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input'));});
  assert.equal(await page.locator('#clock').innerText(),`REPLAY · ${entry.duration_min} min`);
  await page.locator('#signalSelect').selectOption(id==='etec'?'LT':id==='baseline'?'none':'BARRIER_DAMAGE');
  await page.evaluate(()=>VirtualTissuePlayer.view.render(performance.now()));
  if(process.env.CAPTURE_ASSETS){await page.locator('.stage').screenshot({path:`/tmp/virtualtissue-${id}.png`});}
  if(id==='etec'){
   const point=await page.evaluate(()=>{const p=VirtualTissuePlayer;const id=p.episode.decisions.find(d=>d.action==='EPITHELIAL_ION_SECRETION').cell_id;p.view.render(performance.now());return p.view.displayPoints.find(point=>point.id===id).s;});
   const box=await page.locator('#overlay').boundingBox();await page.mouse.click(box.x+point.x,box.y+point.y);
   assert.match(await page.locator('#decision').innerText(),/fixture-not-live-jev/);
   await page.locator('#decisionHistory').selectOption('0');
   assert.match(await page.locator('#constraints').textContent(),/snapshot/);
   const n=requests.length;
   await page.locator('#timeline').evaluate(el=>{el.value=0;el.dispatchEvent(new Event('input'));});
   assert.match(await page.locator('#decision').innerText(),/No decision/);
   assert.equal(requests.length,n);
  }
  console.log(`PASS ${id}: URL load, play, seek, fixture provenance and saved final state`);
 }
 await page.goto(`${base}/player.html?recording=https://example.com/private.gz`);
 await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('not in'));
 assert.equal(await page.evaluate(()=>VirtualTissuePlayer.episode),null);
 await page.locator('#file').setInputFiles(path.join(root,'site/episodes',catalog[3].file));
 await page.waitForFunction(()=>VirtualTissuePlayer.episode?.metadata.scenario.id==='baseline');
 console.log('PASS unknown URL rejected; local file fallback works');
 if(!process.env.CAPTURE_ASSETS){
 await page.goto(base);await page.locator('h1').waitFor();
 for(const image of await page.locator('img').all())await image.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 await page.evaluate(()=>scrollTo(0,0));
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1000});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
  assert(await page.evaluate(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0)),'all images loaded');
  await page.screenshot({path:`/tmp/virtualtissue-site-${width}.png`,fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1050});
 await page.locator('#step-1').click();assert.match(await page.locator('#step-title').innerText(),/Biology/);
 await page.locator('#step-1').press('ArrowDown');assert.equal(await page.locator('#step-2').getAttribute('aria-selected'),'true');
 await page.locator('#step-2').press('End');assert.match(await page.locator('#step-title').innerText(),/process/);
 assert.equal(await page.locator('.episode-launch').count(),4);
 await page.locator('.episode-launch').first().click();await page.waitForFunction(()=>VirtualTissuePlayer?.episode);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'/tmp/virtualtissue-player-mobile.png',fullPage:true});
 console.log('PASS landing: images, four viewport widths, keyboard walkthrough, episode navigation, mobile player');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
 assert(requests.every(r=>r.method==='GET'&&new URL(r.url).origin===new URL(base).origin));
 assert(requests.every(r=>!new URL(r.url).pathname.startsWith('/api/')));
 console.log('PASS no JavaScript errors, failed resources, external requests or API calls');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
