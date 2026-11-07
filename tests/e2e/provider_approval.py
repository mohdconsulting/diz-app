"""E2e: a provider that admin has not activated sees jobs but cannot make offers; admin activates (diz_provider_approval.sql).
Usage:  npm run build && python3 tests/e2e/provider_approval.py"""
import asyncio, pathlib, sys
from playwright.async_api import async_playwright
R = pathlib.Path(__file__).resolve().parent.parent.parent; E = R/'tests/e2e'; URL = (R/'index.html').as_uri()
res = []
def check(l, c): res.append(('PASS ' if c else '*** FAIL ') + l); print(res[-1], flush=True)
DB = "JSON.parse(sessionStorage.getItem('dbs')).db"
def setdb(js): return "(()=>{const s=JSON.parse(sessionStorage.getItem('dbs')); const db=s.db; " + js + "; sessionStorage.setItem('dbs',JSON.stringify(s));})()"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 420, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script((E/'fake-webrtc.js').read_text())
        await pg.add_init_script("try{ if(!localStorage.getItem('diz_lang')) localStorage.setItem('diz_lang','en'); }catch(e){}")
        await pg.route('**/@supabase/supabase-js@2', lambda r: r.fulfill(body=(E/'fake-supabase.js').read_text(), content_type='application/javascript'))
        await pg.route('**/fonts.g*/**', lambda r: r.abort())
        await pg.route('**/leaflet@*/**', lambda r: r.fulfill(body='', content_type='application/javascript'))
        await pg.goto(URL); await pg.wait_for_timeout(800)

        async def register(name, phone, role, prof=None):
            await pg.click('#authSwitchBtn')
            await pg.fill('#authNameInput', name); await pg.fill('#authPhoneInput', phone)
            await pg.fill('#authEmailInput', phone + '@x.io'); await pg.fill('#authPassInput', 'secret1')
            await pg.click(f'#authRoleChips .chip[data-val={role}]')
            if prof: await pg.click(f'#authProfileChips .chip[data-val={prof}]')
            await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(700)
        async def login(phone):
            await pg.fill('#authPhoneInput', phone); await pg.fill('#authPassInput', 'secret1')
            await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(800)
        async def logout():
            await pg.click('#logoutBtn'); await pg.wait_for_timeout(300)

        # customer posts a home-service job
        await register('Cust', '0700', 'customer')
        await pg.evaluate("goTo('new')"); await pg.wait_for_timeout(200)
        await pg.click('#serviceChips .chip[data-val=pro]'); await pg.click('#catChips .chip[data-val=painter]')
        await pg.fill('#descInput', 'Paint the hall'); await pg.fill('#addrInput', 'Street 1'); await pg.fill('#customPriceInput', '30000')
        await pg.click('#submitBtn'); await pg.wait_for_timeout(600)
        check('job created', await pg.evaluate(DB + ".jobs.length") == 1)
        await logout()

        # new provider: the DB default is "not activated"
        await register('Painter', '0722', 'driver', 'painter')
        await pg.evaluate(setdb("db.users.find(u=>u.phone==='0722').approved=false"))
        await pg.reload(); await pg.wait_for_timeout(900)
        check('pending banner shown', await pg.is_visible('#approvalNote') and 'activated' in await pg.inner_text('#approvalNote'))
        await pg.evaluate("goTo('jobs')"); await pg.wait_for_timeout(300)
        check('job visible to pending provider', await pg.locator('#jobsList .card').count() == 1)
        check('no offer controls while pending', await pg.locator('#jobsList button:has-text("Apply at this price")').count() == 0 and await pg.locator('#jobsList .offer-row').count() == 0)
        await pg.evaluate("submitOffer(JSON.parse(sessionStorage.getItem('dbs')).db.jobs[0].id)"); await pg.wait_for_timeout(400)
        check('offer blocked while pending', await pg.evaluate("(" + DB + ".jobs[0].applicants||[]).length") == 0)
        await logout()

        # admin activates
        await login('admin1')
        await pg.evaluate("goTo('adminUsers')"); await pg.wait_for_timeout(400)
        first = pg.locator('#adminUsersList .card').first
        check('pending provider listed first', 'Painter' in await first.inner_text() and 'Waiting for activation' in await first.inner_text())
        check('skills shown to admin', 'Painter' in await first.inner_text() and 'Skills' in await first.inner_text())
        await first.locator('button:has-text("Activate")').click(); await pg.wait_for_timeout(400)
        check('approved in db', await pg.evaluate(DB + ".users.find(u=>u.phone==='0722').approved") is True)
        check('admin card now active', 'Active' in await pg.locator('#adminUsersList .card').filter(has_text='0722').inner_text())
        await logout()

        # provider can now offer
        await login('0722')
        check('banner gone after activation', not await pg.is_visible('#approvalNote'))
        await pg.evaluate("goTo('jobs')"); await pg.wait_for_timeout(300)
        await pg.locator('#jobsList button:has-text("Apply at this price")').first.click(); await pg.wait_for_timeout(500)
        check('offer saved after activation', await pg.evaluate("(" + DB + ".jobs[0].applicants||[]).length") == 1)

        # admin's list must show the stored status after a fresh load (regression: column missing from the select)
        await logout(); await login('admin1')
        await pg.evaluate("goTo('adminUsers')"); await pg.wait_for_timeout(400)
        check('admin list shows Active after reload', 'Deactivate' in await pg.locator('#adminUsersList .card').filter(has_text='0722').inner_text())
        await pg.evaluate("window.__db.users.find(u=>u.phone==='0722').approved=false")
        await logout(); await login('admin1')
        await pg.evaluate("goTo('adminUsers')"); await pg.wait_for_timeout(400)
        card = pg.locator('#adminUsersList .card').filter(has_text='0722')
        check('admin list shows pending after reload', 'Waiting for activation' in await card.inner_text() and await card.locator('button:has-text("Activate")').count() == 1)
        await card.locator('button:has-text("Activate")').click(); await pg.wait_for_timeout(300)
        await logout(); await login('0722')

        # activation picked up without logging out (window focus)
        await pg.evaluate("window.__db.users.find(u=>u.phone==='0722').approved=false")
        await pg.reload(); await pg.wait_for_timeout(900)
        await pg.evaluate("window.__db.users.find(u=>u.phone==='0722').approved=true")
        await pg.evaluate("window.dispatchEvent(new Event('focus'))"); await pg.wait_for_timeout(500)
        check('activation picked up on focus', not await pg.is_visible('#approvalNote'))

        # deactivated again by admin -> banner returns on next load
        await pg.evaluate(setdb("db.users.find(u=>u.phone==='0722').approved=false"))
        await pg.reload(); await pg.wait_for_timeout(900)
        check('banner back when deactivated', await pg.is_visible('#approvalNote'))

        check('no page errors', not errs)
        if errs: print(errs)
        await b.close()
asyncio.run(main())
sys.exit(1 if any(r.startswith('***') for r in res) else 0)
