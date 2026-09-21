"""Real WebGL outcomes with explicitly prepared fixture states; no paid calls."""
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
 def open(self,req,timeout):
  r=json.loads(req.data)
  return FakeResponse({'model':'fixture-v5-not-live','usage':{'input_tokens':1,'output_tokens':1},'answers':{k:{'type':'choice','choice':'WAIT','probabilities':{a:int(a=='WAIT') for a in q['criteria']},'confidence':1} for k,q in r['questions'].items()}})
class Handler(server.Handler):
 def log_message(self,*a):pass
async def main():
 server.KEY='fixture-only';server.OPENER=Fixture();http=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=http.serve_forever,daemon=True).start()
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
   page=await browser.new_page(viewport={'width':1500,'height':1100});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(f'http://127.0.0.1:{http.server_port}');await page.wait_for_function('window.Cellville&&document.querySelector("#connectionBadge").textContent.includes("configured")');await page.locator('#durationInput').fill('10080');await page.locator('#discardBtn').click();await page.evaluate('Cellville.setRenderPaused(true)')
   check('Eight identities without mode selectors',await page.locator('#legend button').count()==8 and await page.locator('#ruleModeSelect').count()==0)
   await page.locator('[data-cell-type="dendritic"]').click();check('Dendritic identity selectable',await page.locator('#cellName').inner_text()=='Dendritic cell')
   await page.evaluate('''() => {
    const t=Cellville.tissue;
    window.completeTestEvent=(c,id,duration)=>{const e=t.kernel.start(id,t.snapshot(c),duration?{initialized_duration:duration}:{});t.time_min+=Math.ceil(e.duration_min);t.tick=t.time_min;t.revision++;const p=t.kernel.advance(e.id,t.snapshot(c,e),t.time_min);t.commitCompletion({...p,run_id:t.run_id});return e;};
    const n=t.cells.find(c=>c.type==='neutrophil'&&!c.reserve);n.x=.5;n.y=.75;
    for(let i=0;i<t.fields.values.CXCL8.length;i++)if(t.fields.side[i]==='basal')t.fields.deposit('CXCL8',i,(i%t.fields.w+1)*.002);
    completeTestEvent(n,'NEUTROPHIL_CHEMOTAXIS',3);t.recordFrame(true);
   }''');await page.evaluate('Cellville.step(1)');await page.locator('[data-track="movement"]').click()
   check('Movement dashboard reads accepted displacement','12 µm' in await page.locator('#movementCount').inner_text())
   await page.locator('#signalSelect').select_option('CCL2');await page.evaluate('Cellville.view.render(performance.now())');await page.locator('#signalSelect').select_option('all')
   check('Motion inspector retains traveled distance','12.0 µm traveled' in await page.locator('#cellFate').inner_text())
   await page.evaluate('''()=>{const t=Cellville.tissue,c=t.cells[10];c.health=20;c.state.damage=.8;c.state.viability='injured';completeTestEvent(c,'DEATH_COMMITMENT',60);completeTestEvent(c,'DEATH_EXECUTION',15);t.recordFrame(true);}''');await page.evaluate('Cellville.step(1)');await page.locator('[data-track="death"]').click();await page.evaluate('Cellville.view.render(performance.now()+5000)')
   check('Death is a recorded epithelial loss','1 lost' in await page.locator('#deathCount').inner_text())
   check('A corpse is never labeled steady state','Dead cell' in await page.locator('#localState').inner_text())
   check('Corpse remains rendered after 1.5 seconds',await page.evaluate('Cellville.view.displayPoints.some(p=>p.id===Cellville.tissue.cells[10].id)'))
   await page.screenshot(path=str(ROOT/'docs/v5_death.png'),full_page=True)
   await page.evaluate('''()=>{const t=Cellville.tissue,c=t.cells.find(c=>c.state.type==='dendritic');t.inject('epec',c.x);const b=t.lab.bacteria[0];b.x=c.x;b.y=c.y-.02;completeTestEvent(c,'PHAGOCYTOSIS');completeTestEvent(c,'DC_ANTIGEN_PROCESSING',60);t.recordFrame(true);}''');await page.evaluate('Cellville.step(1)');await page.locator('[data-track="antigen"]').click();await page.evaluate('Cellville.view.render(performance.now())')
   check('Presentation requires completed processing','1 presenting' in await page.locator('#antigenCount').inner_text())
   check('Inspector names the actual antigen source','Presenting: EPEC · epec-' in await page.locator('#cellFate').inner_text())
   await page.screenshot(path=str(ROOT/'docs/v5_antigen.png'),full_page=True)
   await page.evaluate('''()=>{const t=Cellville.tissue,c=t.cells.find(c=>c.state.type==='inflammatory_monocyte'&&!c.reserve);c.lab.recruitedAt=t.time_min;c.x=.95;c.y=.8;for(const key of ['TNF','PAMP','DAMP'])t.fields.values[key].fill(0);completeTestEvent(c,'MYELOID_ADAPTATION',1440);t.recordFrame(true);}''');await page.evaluate('Cellville.step(1)');await page.locator('[data-track="adaptation"]').click();await page.evaluate('Cellville.view.render(performance.now())')
   check('Adaptation appears after a days-long clock','1 adapted' in await page.locator('#adaptationCount').inner_text())
   check('Lineage stays monocyte derived','Monocyte-derived macrophage' in await page.locator('#cellName').inner_text() and 'origin preserved' in await page.locator('#cellFate').inner_text())
   await page.screenshot(path=str(ROOT/'docs/v5_adaptation.png'),full_page=True)
   before=await page.evaluate('JSON.stringify(Cellville.tissue.export())');await page.evaluate('for(let i=0;i<5;i++)Cellville.view.render(performance.now()+i*1000)')
   check('New graphics never mutate biology',await page.evaluate('JSON.stringify(Cellville.tissue.export())')==before)
   check('Rapid frame updates preserve a visible movement transition',await page.evaluate("""()=>{const v=Cellville.view,a=structuredClone(v.current),c=a.cells.find(c=>c.type==='neutrophil');v.setFrame(a,true);const b=structuredClone(a);b.cells.find(x=>x.id===c.id).x+=.04;v.setFrame(b);v.setFrame(structuredClone(b));const ok=v.previousById.get(c.id).x<b.cells.find(x=>x.id===c.id).x-.01;v.setFrame(Cellville.tissue.history.at(-1),true);return ok;}"""))
   check('No JavaScript errors',not errors);await browser.close()
 finally:http.shutdown();http.server_close()
 (ROOT/'docs/v5_outcome_browser_tests.json').write_text(json.dumps({'passed':len(checks),'live_jev_calls':0,'prepared_fixture_states':True,'checks':checks},indent=2)+'\n')
asyncio.run(main())
