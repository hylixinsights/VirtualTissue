"""Real WebGL and loopback Jev adapter; upstream responses are fixtures only."""
import asyncio,sys,json,threading,os
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
 def __init__(self):self.requests=[];self.bad=False
 def open(self,req,timeout):
  r=json.loads(req.data);self.requests.append(r);answers={}
  for key,q in r['questions'].items():
   options=list(q['criteria']);a=next((x for x in ['MYELOID_TNF_INDUCTION','EPITHELIAL_CXCL8_INDUCTION','GOBLET_RELEASE','PHAGOCYTOSIS','STROMAL_ACTIVATION','NEUTROPHIL_CHEMOTAXIS'] if x in options),options[-1]);answers[key]={'type':'choice','choice':a,'probabilities':{x:int(x==a) for x in options},'confidence':1}
  if self.bad: next(iter(answers.values()))['probabilities']={a:0 for a in next(iter(r['questions'].values()))['criteria']}
  return FakeResponse({'model':'fixture-not-live','usage':{'input_tokens':50,'output_tokens':10},'answers':answers})
class Handler(server.Handler):
 def log_message(self,*args):pass
async def main():
 upstream=Fixture();server.KEY='fixture-only';server.OPENER=upstream
 http=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=http.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{http.server_port}'
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
   page=await browser.new_page(viewport={'width':1500,'height':1100});page.set_default_timeout(20000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(url);await page.wait_for_function('!!window.Cellville?.view?.gl');await page.wait_for_function('document.querySelector("#connectionBadge").textContent.includes("configured")');await page.evaluate('Cellville.setRenderPaused(true);Cellville.view.render(performance.now())')
   check('One manual-governed tissue, no mode or provider selector',await page.locator('#ruleModeSelect,#providerSelect').count()==0 and await page.evaluate('Cellville.tissue.mode==="unified"'))
   check('Initial steady state is explicit, with zero paid or fixture requests',await page.locator('#activeHud').inner_text()=='0 sensing change' and not upstream.requests)
   check('Latest six-cell morphology renders with a real WebGL 2 context',await page.evaluate('Cellville.view.gl instanceof WebGL2RenderingContext&&Cellville.tissue.cells.length===100&&new Set(Cellville.tissue.cells.map(c=>c.type)).size===6'))
   check('Prompt is visible above the scene',await page.locator('#promptBox').is_visible() and (await page.locator('#promptBox').bounding_box())['y']<(await page.locator('#stage').bounding_box())['y'])
   before=await page.evaluate('JSON.stringify(Cellville.tissue.export())');await page.locator('[data-prompt="EPEC enters on the left"]').click()
   check('Typing a scenario is a preview, not a hidden injection',await page.evaluate('JSON.stringify(Cellville.tissue.export())')==before)
   await page.locator('#applyBtn').click();await page.evaluate('Cellville.stop()');await page.wait_for_function('!Cellville.busy');await page.evaluate('Cellville.view.render(performance.now())')
   check('One click introduces visible pathogen agents',await page.evaluate('Cellville.tissue.lab.bacteria.length===24') and 'EPEC' in await page.locator('#introduced').inner_text())
   check('Arrival is animated without altering cell geometry',await page.evaluate('!!Cellville.view.arrival&&Cellville.view.arrival.title==="EPEC"'))
   check('Near cells activate while distant cells remain quiet',await page.evaluate('Cellville.tissue.metrics.active>0&&Cellville.tissue.metrics.active<50'))
   check('No CXCL8 is injected by the scenario',await page.evaluate('Cellville.tissue.fields.amount("CXCL8")===0'))
   await page.locator('#inspectBtn').click();await page.get_by_text('Constraints & unavailable actions',exact=True).click();check('Inspector exposes local trigger and manual constraints', 'Detects:' in await page.locator('#localState').inner_text() and await page.locator('#blockedActions').inner_text()!='')
   await page.get_by_text('Constraints & unavailable actions',exact=True).click();await page.evaluate('Cellville.view.home();Cellville.view.render(performance.now())');await page.screenshot(path=str(ROOT/'docs/v5_pathogen.png'),full_page=True)
   await page.evaluate('Cellville.step(30)');await page.wait_for_function('!Cellville.busy');await page.locator('#inspectBtn').click();await page.evaluate('Cellville.view.render(performance.now())')
   check('Jev receives separate manual action questions for actual cells',bool(upstream.requests) and all(q['type']=='choice' and 'local_observation' in q['instructions'] for r in upstream.requests for q in r['questions'].values()))
   check('Biological preparation has visible progress',await page.evaluate('Cellville.tissue.metrics.preparing>0') and 'preparing' in await page.locator('#responses').inner_text())
   check('No global scenario or tissue map is sent to individual cells',all('patches' not in json.dumps(r) and 'A pathogen enters' not in json.dumps(r) for r in upstream.requests))
   await page.screenshot(path=str(ROOT/'docs/v5_decisions.png'),full_page=True)
   saved=await page.evaluate('JSON.stringify(Cellville.tissue.export())');calls=len(upstream.requests)
   await page.locator('#historySlider').evaluate("e=>{e.value='0';e.dispatchEvent(new Event('input'))}");await page.evaluate('Cellville.view.render(performance.now())')
   check('Replay is recorded-only and never consults Jev',len(upstream.requests)==calls and await page.evaluate('JSON.stringify(Cellville.tissue.export())')==saved and 'REPLAY' in await page.locator('#clock').inner_text())
   check('Replay blocks perturbation and biological advance',await page.locator('#applyBtn').is_disabled() and await page.locator('#stepBtn').is_disabled())
   await page.locator('#liveBtn').click();await page.locator('#discardBtn').click()
   check('Only the four release scenarios are offered',await page.locator('#scenarioSelect option').evaluate_all("xs=>xs.map(x=>x.value)")==['etec','epec','ibd','baseline'])
   check('No removed perturbation is advertised', 'lactose' not in (await page.locator('body').inner_text()).lower())
   saved=await page.evaluate('JSON.stringify(Cellville.tissue.export())');await page.evaluate('for(let i=0;i<3;i++)Cellville.view.render(performance.now()+i*100)')
   check('Animation and camera do not mutate physiology or RNG',await page.evaluate('JSON.stringify(Cellville.tissue.export())')==saved)
   await page.locator('#discardBtn').click();await page.locator('[data-prompt="Focal IBD-like inflammation on the left"]').click();await page.locator('#applyBtn').click();await page.evaluate('Cellville.stop()');await page.wait_for_function('!Cellville.busy');await page.evaluate('Cellville.view.render(performance.now())')
   check('IBD-like prompt visibly injures the barrier without adding TNF',await page.evaluate('Cellville.tissue.metrics.barrier<1&&Cellville.tissue.fields.amount("TNF")===0'))
   await page.screenshot(path=str(ROOT/'docs/v5_injury.png'),full_page=True)
   await page.locator('#discardBtn').click();await page.locator('[data-prompt="A focal tissue injury in the center"]').click();await page.locator('#applyBtn').click();await page.evaluate('Cellville.stop()');await page.wait_for_function('!Cellville.busy')
   check('Direct injury focuses its damaged core and displays 80% damage with zero LT', '80.0%' in await page.locator('#barrierDamageValue').inner_text() and await page.locator('#cellDamageValue').inner_text()=='80.0%' and await page.locator('#ltValue').inner_text()=='0' and await page.evaluate('Cellville.view.options.signals==="CELL_DAMAGE"&&Cellville.tissue.cellById.get(Cellville.view.selected).health<21'))
   await page.locator('[data-readout="BARRIER_DAMAGE"]').click();await page.evaluate('Cellville.view.render(performance.now())')
   check('Damage readout selects an injured epithelial cell and visible junction marks',await page.evaluate('Cellville.view.diagnosticMarkers.filter(m=>m.kind==="BARRIER_DAMAGE").length===6&&Cellville.tissue.slots.find(s=>s.cell===Cellville.view.selected).junction<.21') and 'Barrier damage' in await page.locator('#readings').inner_text())
   await page.locator('[data-readout="CELL_DAMAGE"]').click();await page.evaluate('Cellville.view.render(performance.now())')
   check('Cell damage selects the wound core with low health and visible damage rings',await page.evaluate('Cellville.tissue.cellById.get(Cellville.view.selected).health<21&&Cellville.view.diagnosticMarkers.filter(m=>m.kind==="CELL_DAMAGE").length===6'))
   await page.screenshot(path=str(ROOT/'docs/diagnostics_injury.png'),full_page=True)
   await page.locator('[data-readout="LT"]').click();await page.evaluate('Cellville.view.render(performance.now())')
   check('Injury cannot invent toxin markers and explains why LT is zero',await page.evaluate('Cellville.view.diagnosticMarkers.length===0') and 'produced by ETEC' in await page.locator('#signalNote').inner_text())
   check('No browser errors',not errors)
   await page.locator('#discardBtn').click()
   await page.evaluate('Cellville.tissue.cells[0].health=80;Cellville.tissue.cells[0].state.memory.alarm=.8')
   state_expr='JSON.stringify({tick:Cellville.tissue.tick,revision:Cellville.tissue.revision,cells:Cellville.tissue.cells,fields:Cellville.tissue.fields.values,rng:Cellville.tissue.rngDraws})'
   before_failure=await page.evaluate(state_expr);upstream.bad=True
   await page.evaluate('Cellville.step(1)');await page.wait_for_function('!Cellville.busy')
   check('Invalid probabilities pause visibly without committing a partial round','sum to 1' in await page.locator('#errorBox').inner_text() and await page.evaluate(state_expr)==before_failure and not await page.evaluate('Cellville.playing'))
   check('Failed request usage is retained honestly',await page.evaluate('Cellville.tissue.requestAudit.some(r=>r.status==="failed"&&r.meta.calls>0)'))
   check('Failed recording remains saveable and cannot silently resume',await page.evaluate('Cellville.recorder.closed&&Cellville.recorder.data.metadata.status==="partial"'));upstream.bad=False;await page.locator('#discardBtn').click();await page.evaluate('Cellville.tissue.cells[0].health=80;Cellville.tissue.cells[0].state.memory.alarm=.8;Cellville.step(1)')
   check('A new independent recording can proceed after an upstream failure',await page.evaluate('Cellville.tissue.time_min===1') and not await page.locator('#errorBox').is_visible())
   await page.close()
   mobile=await browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1);await mobile.goto(url);await mobile.wait_for_function('!!window.Cellville?.view?.gl');await mobile.evaluate('Cellville.setRenderPaused(true)')
   await mobile.locator('[data-prompt="EPEC enters on the left"]').tap();await mobile.locator('#applyBtn').tap();await mobile.evaluate('Cellville.stop()');await mobile.wait_for_function('!Cellville.busy');await mobile.locator('#inspectBtn').tap();await mobile.evaluate('Cellville.view.render(performance.now())')
   check('Mobile touch flow introduces a perturbation and inspects an activated cell',await mobile.evaluate('Cellville.tissue.lab.bacteria.length===24&&!!Cellville.view.selected'))
   check('Mobile page fits without horizontal overflow',await mobile.evaluate('document.body.scrollWidth<=innerWidth'))
   await mobile.screenshot(path=str(ROOT/'docs/v5_mobile.png'),full_page=True);await mobile.close()
   offline=await browser.new_page();await offline.goto((ROOT/'Cellville_3D.html').as_uri());await offline.wait_for_function('!!window.Cellville?.view?.gl');check('Opening the HTML directly explains exactly how to connect Jev',await offline.locator('#connectionPanel').is_visible() and 'Start Cellville.command' in await offline.locator('#connectionText').inner_text());await browser.close()
 finally:http.shutdown();http.server_close()
 (ROOT/'docs/v5_browser_tests.json').write_text(json.dumps({'passed':len(checks),'failed':0,'live_jev_calls':0,'provider':'upstream fixture over the real local HTTP adapter','checks':checks},indent=2)+'\n')
asyncio.run(main())
