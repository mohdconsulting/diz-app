"""Webbläsartest för Jobbmatch.  python3 tests/e2e.py
Arbetsförmedlingens API ersätts med testdata; ett andra varv simulerar att API:t inte går att nå (exempelannonser)."""
import asyncio, json, pathlib, sys, threading, functools, http.server, re
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
res = []
def check(l, c): res.append(('PASS ' if c else '*** FAIL ') + l); print(res[-1], flush=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    h = functools.partial(Quiet, directory=str(ROOT))
    s = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

LIVE = {"total": {"value": 2}, "hits": [
  {"id": "af-1", "headline": "Lagerarbetare till e-handel", "occupation": {"label": "Lagerarbetare"},
   "employer": {"name": "Testlager AB"}, "workplace_address": {"municipality": "Stockholm", "region": "Stockholms län"},
   "description": {"text": "Plock och pack. Krav: truckkort. WMS-system."}, "webpage_url": "https://arbetsformedlingen.se/platsbanken/annonser/1",
   "application_details": {"url": "https://example.com/apply/1"}, "publication_date": "2026-11-12T08:00:00", "application_deadline": "2026-12-01T23:59:59"},
  {"id": "af-2", "headline": "Ekonomiassistent", "occupation": {"label": "Ekonomiassistent"},
   "employer": {"name": "Testbolaget AB"}, "workplace_address": {"municipality": "Luleå"},
   "description": {"text": "Bokföring och fakturor."}, "webpage_url": "https://arbetsformedlingen.se/platsbanken/annonser/2"}]}

async def main():
    srv = serve(); url = f'http://127.0.0.1:{srv.server_port}/index.html'
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 420, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        queries = []; mode = {'live': True}
        async def api(route):
            queries.append(route.request.url)
            if mode['live']: await route.fulfill(body=json.dumps(LIVE), content_type='application/json', headers={'access-control-allow-origin': '*'})
            else: await route.abort()
        await pg.route('https://jobsearch.api.jobtechdev.se/**', api)
        await pg.add_init_script("window.__opened=[]; window.open=(u)=>{window.__opened.push(u); return null;};")
        await pg.goto(url); await pg.wait_for_timeout(300)

        check('starts on profile tab', await pg.is_visible('#panel-profile') and not await pg.is_visible('#panel-jobs'))
        await pg.click('#saveBtn'); await pg.wait_for_timeout(200)
        check('role required', 'yrke' in await pg.inner_text('#toast') and await pg.is_visible('#panel-profile'))

        await pg.fill('#p_name', 'Ali Hassan'); await pg.fill('#p_role', 'Lagerarbetare'); await pg.fill('#p_city', 'Stockholm')
        await pg.fill('#p_skills', 'truckkort, B-körkort'); await pg.fill('#p_phone', '070-123 45 67')
        await pg.fill('#p_cv', 'Lagerarbetare med fem års erfarenhet av plock och pack.\nAnvänt WMS dagligen.')
        await pg.click('#saveBtn'); await pg.wait_for_timeout(600)
        check('jobs tab after save', await pg.is_visible('#panel-jobs'))
        check('api queried with role + city', any('q=Lagerarbetare+Stockholm' in q for q in queries))
        jobs = pg.locator('#jobList .job')
        check('irrelevant job filtered out', await jobs.count() == 1)
        first = jobs.first
        check('job card content', 'Lagerarbetare till e-handel' in await first.inner_text() and 'Testlager AB' in await first.inner_text())
        score = int(re.search(r'(\d+)%', await first.locator('.score').inner_text()).group(1))
        check(f'high score ({score}%)', score >= 70)
        txt = await first.inner_text()
        check('reasons shown', all(s in txt for s in ['Rätt yrke', 'Rätt ort', 'truckkort', 'wms']))
        check('live source text', 'Platsbanken' in await pg.inner_text('#jobSource'))

        await first.locator('[data-act=more]').click(); await pg.wait_for_timeout(100)
        check('description expands', 'Plock och pack' in await first.inner_text())

        await first.locator('[data-act=write]').click(); await pg.wait_for_timeout(200)
        letter = await pg.input_value('#letterText')
        check('letter dialog', await pg.is_visible('#letterDialog') and 'hos Testlager AB' in letter and 'Ali Hassan' in letter and '070-123 45 67' in letter)
        await pg.click('#letterCopy'); await pg.wait_for_timeout(200)
        check('letter copied', 'hos Testlager AB' in await pg.evaluate('navigator.clipboard.readText()'))
        await pg.click('#letterApply'); await pg.wait_for_timeout(300)
        check('apply opens application url', await pg.evaluate('window.__opened') == ['https://example.com/apply/1'])
        check('marked as applied', 'Sökt' in await first.locator('[data-act=mark]').inner_text() and not await pg.is_visible('#letterDialog'))
        check('tab badge', await pg.inner_text('#appliedCount') == '1')

        await pg.click('.tabs button[data-tab=applied]'); await pg.wait_for_timeout(200)
        rows = pg.locator('#appliedBody tr')
        check('report row', await rows.count() == 1 and 'Testlager AB' in await rows.first.inner_text())
        await pg.click('#copyReportBtn'); await pg.wait_for_timeout(200)
        check('report copied', 'Testlager AB\tLagerarbetare till e-handel\tStockholm, Stockholms län' in await pg.evaluate('navigator.clipboard.readText()'))
        async with pg.expect_download() as d: await pg.click('#csvBtn')
        dl = await d.value; csv = pathlib.Path(await dl.path()).read_text(encoding='utf-8-sig')
        check('csv export', dl.suggested_filename.startswith('sokta-jobb-') and csv.startswith('Datum;Arbetsgivare') and 'Testlager AB' in csv)
        await pg.fill('#monthInput', '2020-01'); await pg.dispatch_event('#monthInput', 'change'); await pg.wait_for_timeout(100)
        check('other month empty', 'Inga sökta' in await pg.inner_text('#appliedBody') and await pg.is_disabled('#csvBtn'))

        # persistence + arabic
        await pg.reload(); await pg.wait_for_timeout(600)
        check('profile kept, opens on jobs', await pg.is_visible('#panel-jobs') and await pg.input_value('#p_name') == 'Ali Hassan')
        await pg.click('#langSwitch button[data-lang=ar]'); await pg.wait_for_timeout(200)
        check('arabic rtl', await pg.evaluate('document.documentElement.dir') == 'rtl' and 'وظائف لي' in await pg.inner_text('.tabs'))
        check('applied kept after reload', 'تم التقديم' in await pg.locator('#jobList .job').first.inner_text())
        await pg.click('.tabs button[data-tab=applied]'); await pg.wait_for_timeout(200)
        await pg.click('#appliedBody [data-remove]'); await pg.wait_for_timeout(200)
        check('remove from report', await pg.inner_text('#appliedCount') == '')
        await pg.screenshot(path='/tmp/jm_ar.png', full_page=True)

        # API down -> demo jobs
        mode['live'] = False
        await pg.click('#langSwitch button[data-lang=sv]')
        await pg.click('.tabs button[data-tab=jobs]'); await pg.click('#refreshBtn'); await pg.wait_for_timeout(800)
        check('demo fallback', 'exempelannonser' in await pg.inner_text('#jobSource') and await pg.locator('#jobList .job').count() >= 1)
        check('demo badge', 'Exempelannons' in await pg.locator('#jobList .job').first.inner_text())
        check('demo top match', 'Lagerarbetare med truckkort' in await pg.locator('#jobList .job').first.inner_text())
        await pg.screenshot(path='/tmp/jm_sv.png', full_page=False)

        check('no page errors' + ('' if not errs else ': ' + '; '.join(errs)), not errs)
        await b.close()
    srv.shutdown()
    fails = [r for r in res if 'FAIL' in r]
    print(f"\n{len(res)-len(fails)}/{len(res)} passed"); sys.exit(1 if fails else 0)
asyncio.run(main())
