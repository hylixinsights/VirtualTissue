"""Record over the real local adapter, save/reset, and replay with zero network calls."""
import asyncio,json,os,sys,threading
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import server
from test_typesafe import FakeResponse
checks=[]
def check(name,ok):
 checks.append({'name':name,'passed':bool(ok)});print(('PASS ' if ok else 'FAIL ')+name,flush=True);assert ok,name
class Fixture:
 def __init__(self):self.calls=0
 def open(self,req,timeout):
  self.calls+=1;r=json.loads(req.data)
  answers={}
  for k,q in r['questions'].items():
   action='EPITHELIAL_ION_SECRETION' if 'EPITHELIAL_ION_SECRETION' in q['criteria'] else 'WAIT'
   answers[k]={'type':'choice','choice':action,'probabilities':{a:int(a==action) for a in q['criteria']},'confidence':1}
  return FakeResponse({'model':'browser-fixture-not-live','usage':{'input_tokens':1,'output_tokens':1},'answers':answers})
class Handler(server.Handler):
 def log_message(self,*args):pass
async def wait_value(page,expression):
 for _ in range(200):
  if await page.evaluate(expression):return
  await page.wait_for_timeout(100)
 raise AssertionError('Timed out: '+expression)
async def main():
 fixture=Fixture();server.KEY='fixture-only';server.OPENER=fixture;http=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=http.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{http.server_port}'
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
   page=await browser.new_page(viewport={'width':1600,'height':1100});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(url);await page.wait_for_function('window.Cellville&&document.querySelector("#connectionBadge").textContent.includes("configured")');await page.evaluate('Cellville.setRenderPaused(true)')
   await page.locator('#durationInput').fill('40');await page.locator('#callLimitInput').fill('100');await page.locator('#startRecording').click();await page.evaluate('Cellville.stop()');await page.wait_for_function('!Cellville.busy');await page.evaluate('Cellville.step(60)')
   check('Preset recording stops automatically at its biological duration',await page.evaluate('Cellville.tissue.time_min===40&&Cellville.recorder.closed&&!Cellville.playing'))
   check('ETEC has its own toxin-driven Jev choices',await page.evaluate('Cellville.tissue.lab.etecWater>0&&Cellville.tissue.decisions.some(d=>d.action==="EPITHELIAL_ION_SECRETION")'))
   check('Every live-adapter decision is retained in the recording',await page.evaluate('Cellville.recorder.data.decisions.length===Cellville.recorder.data.rounds.reduce((n,r)=>n+r.request.cells.length,0)'))
   await page.evaluate('Cellville.view.render(performance.now())');await page.screenshot(path=str(ROOT/'docs/studio_recording.png'),full_page=True)
   async with page.expect_download() as saved:await page.locator('#exportBtn').click()
   download=await saved.value;temp=Path(await download.path());saved_episode=await page.evaluate('Cellville.recorder.data.metadata.run_id')
   check('Saving produces a portable gzip episode',download.suggested_filename.endswith('.vt.json.gz'))
   await page.locator('#discardBtn').click();check('Reset clears toxin, decisions and prior run ID',await page.evaluate(f'Cellville.tissue.time_min===0&&Cellville.tissue.lab.bacteria.length===0&&Cellville.tissue.fields.amount("LT")===0&&Cellville.tissue.decisions.length===0&&Cellville.tissue.run_id!=={json.dumps(saved_episode)}'))
   calls=fixture.calls;await page.locator('#scenarioSelect').select_option('baseline');await page.locator('#durationInput').fill('10');await page.locator('#startRecording').click();await page.evaluate('Cellville.stop()');await page.wait_for_function('!Cellville.busy');await page.evaluate('Cellville.step(10)')
   check('Second scenario records from a new baseline and makes zero additional Jev calls',fixture.calls==calls and await page.evaluate('Cellville.recorder.data.metadata.scenario.id==="baseline"&&Cellville.recorder.data.frames[0].time_min===0&&Cellville.recorder.data.frames[0].lab.bacteria.length===0&&Cellville.tissue.lab.bacteria.length===0'))
   await page.locator('#discardBtn').click();await page.locator('#scenarioSelect').select_option('ibd');await page.locator('#callLimitInput').fill('1');await page.locator('#startRecording').click();await page.evaluate('Cellville.stop()');await page.wait_for_function('!Cellville.busy');await page.evaluate('Cellville.step(60)')
   check('Request cap saves a partial recording and disables silent continuation',await page.evaluate('Cellville.recorder.closed&&Cellville.recorder.data.metadata.status==="partial"&&Cellville.tissue.apiCalls<=1') and await page.locator('#playBtn').is_disabled())
   await page.locator('#discardBtn').click();await page.locator('#callLimitInput').fill('1');await page.locator('#promptBox').fill('ETEC enters on the left');await page.locator('#applyBtn').click();await page.evaluate('Cellville.stop()');await page.wait_for_function('!Cellville.busy');await page.evaluate('Cellville.step(60)')
   check('Custom prompt honors the same visible request cap',await page.evaluate('Cellville.tissue.apiCalls<=1&&Cellville.recorder.closed&&Cellville.recorder.data.metadata.status==="partial"'))
   player=await browser.new_page(viewport={'width':1500,'height':1050});player.on('pageerror',lambda e:errors.append(str(e)))
   await player.goto((ROOT/'player.html').as_uri());await wait_value(player,'!!window.VirtualTissuePlayer');requests=[];player.on('request',lambda r:requests.append(r.url));await player.locator('#file').set_input_files(temp);await wait_value(player,'!!VirtualTissuePlayer.episode')
   check('Standalone player loads an exported episode directly from file',await player.evaluate(f'VirtualTissuePlayer.episode.metadata.run_id==={json.dumps(saved_episode)}&&typeof window.Cellville==="undefined"'))
   await player.locator('#speed').select_option('10');await player.locator('#play').click();await wait_value(player,'VirtualTissuePlayer.index>=3');await player.locator('#play').click();await player.locator('#timeline').evaluate("e=>{e.value=e.max;e.dispatchEvent(new Event('input'))}")
   check('Playback and seeking reach the stored final biological state',await player.locator('#clock').inner_text()=='REPLAY · 40 min')
   # Click a real projected cell, rather than injecting inspector state.
   point=await player.evaluate("()=>{VirtualTissuePlayer.view.render(performance.now());const e=VirtualTissuePlayer.episode;const id=e.decisions.find(d=>d.action==='EPITHELIAL_ION_SECRETION').cell_id;return VirtualTissuePlayer.view.displayPoints.find(p=>p.id===id).s;}")
   box=await player.locator('#overlay').bounding_box();await player.mouse.click(box['x']+point['x'],box['y']+point['y'])
   await player.get_by_text('Exact local snapshot and constraint checks',exact=True).click()
   check('Cell inspector reads stored local observations and returned probabilities','browser-fixture-not-live' in await player.locator('#decision').inner_text() and 'snapshot' in await player.locator('#constraints').inner_text())
   await player.locator('#decisionHistory').select_option('0')
   check('Earlier individual decisions can be inspected independently of visual sampling','Recorded at' in await player.locator('#decision').inner_text() and await player.locator('#decisionHistory option').count()>1)
   await player.get_by_text('Exact local snapshot and constraint checks',exact=True).click()
   await player.screenshot(path=str(ROOT/'docs/offline_player.png'),full_page=True)
   await player.locator('#timeline').evaluate("e=>{e.value=0;e.dispatchEvent(new Event('input'))}")
   check('Baseline inspection never leaks a future decision','No decision had been recorded' in await player.locator('#decision').inner_text())
   check('Loading, playing, seeking and inspecting make zero network requests',not requests)
   for file in (ROOT/'recordings/examples').glob('*.gz'):
    await player.locator('#file').set_input_files(file);await wait_value(player,'VirtualTissuePlayer.index===0');await player.wait_for_timeout(200)
    check('Fixture label is visible for '+file.name.split('-')[0],'OFFLINE FIXTURE' in await player.locator('#provenance').inner_text())
   manual=await browser.new_page();await manual.goto(url+'/manual.html');check('Manual v3 exposes the active rule contracts and scientific scope',await manual.locator('h1').inner_text()=='Manual v3 — Gut tissue' and await manual.locator('section.action').count()==56)
   check('No JavaScript errors',not errors)
   await browser.close()
 finally:http.shutdown();http.server_close()
 (ROOT/'docs/episode_browser_tests.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'live_jev_calls':0},indent=2)+'\n')
asyncio.run(main())
