"""End-to-end smoke test of the built index.html against an in-memory fake of supabase-js.
Covers: register/login, create job, apply, assign, arrive, done, report problem, respond, admin release, history, i18n, session restore.
Usage:  npm run build && python3 tests/e2e/smoke.py     (needs: pip install playwright && playwright install chromium)"""
import asyncio, sys, pathlib
from playwright.async_api import async_playwright
HERE=pathlib.Path(__file__).resolve().parent
stub=(HERE/'fake-supabase.js').read_text()
URL=(HERE/'../../index.html').resolve().as_uri()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        pg=await b.new_page(viewport={'width':420,'height':900})
        errs=[]
        pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e)))
        pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and 'fonts' not in m.text and 'ERR_FAILED' not in m.text else None)
        await pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body=stub,content_type='application/javascript'))
        await pg.route('**/fonts.g*/**',lambda r:r.abort())
        await pg.goto(URL); await pg.wait_for_timeout(500)
        ok=True
        def check(label,cond):
            nonlocal ok
            print(('PASS ' if cond else '*** FAIL ')+label); ok = ok and bool(cond)
        screen=lambda: pg.evaluate("document.querySelector('.screen.active').dataset.screen")
        async def reg(name,phone,role):
            await pg.click('#authSwitchBtn')
            await pg.fill('#authNameInput',name); await pg.fill('#authPhoneInput',phone); await pg.fill('#authPassInput','secret1')
            await pg.click(f'#authRoleChips .chip[data-val={role}]')
            if role=='driver': await pg.click('#authProfileChips .chip[data-val=driver]')
            await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(700)
        async def login(phone):
            await pg.fill('#authPhoneInput',phone); await pg.fill('#authPassInput','secret1')
            await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(700)
        async def logout():
            await pg.click('#logoutBtn'); await pg.wait_for_timeout(300)
        async def click_btn(fn, nth=0):
            await pg.locator(f'button[onclick^="{fn}("]:visible').nth(nth).click(); await pg.wait_for_timeout(600)

        # --- customer registers & creates a job via the UI
        await reg('Kund','0770111','customer')
        check('customer lands on home', await screen()=='home')
        await pg.click('.tabbar button[data-tab=new]')
        await pg.click('#serviceChips .chip[data-val=junk]'); await pg.click('#catChips .chip >> nth=0'); await pg.click('#sizeChips .chip >> nth=0')
        await pg.fill('#descInput','Gammal soffa'); await pg.fill('#addrInput','Karrada')
        await pg.click('#submitBtn'); await pg.wait_for_timeout(800)
        check('job stored', await pg.evaluate("__db.jobs.length")==1)
        check('back on home with card', await pg.locator('#homeList .card').count()==1)
        await logout()
        # --- driver registers, applies
        await reg('Ali','0780222','driver')
        check('driver lands on jobs', await screen()=='jobs')
        check('driver sees open job', await pg.locator('#jobsList .card').count()>=1)
        href=await pg.locator('#jobsList a.maplink').first.get_attribute('href')
        check('address links to Google Maps', href.startswith('https://www.google.com/maps/search/?api=1&query='))
        await click_btn('submitOffer')
        check('applicant stored', await pg.evaluate("__db.jobs[0].applicants.length")==1)
        await logout()
        # --- customer assigns
        await login('0770111')
        check('customer applicant flag on card', await pg.locator('#homeList .flag').count()==1)
        await pg.click('.tabbar button[data-tab=mine]'); await pg.wait_for_timeout(300)
        # "assign & pay" is one step: the job is only assigned once the (mock) payment succeeds
        await click_btn('assignJob')
        check('mock checkout shown', await pg.locator('button[onclick^="mockPay("]:visible').count()==1)
        check('not assigned before payment', await pg.evaluate("__db.jobs[0].status")=='open')
        await click_btn('cancelMockCheckout')
        check('still open after cancelling checkout', await pg.evaluate("__db.jobs[0].status")=='open')
        await click_btn('assignJob'); await pg.locator('button[onclick^="mockPay("]:visible').click(); await pg.wait_for_timeout(800)
        check('assigned by payment', await pg.evaluate("__db.jobs[0].status")=='accepted' and await pg.evaluate("__db.jobs[0].accepted_by_phone")=='0780222')
        check('payment held', await pg.evaluate("__db.payments.map(p=>p.status).join()")=='held')
        check('no pay button after assigning', await pg.locator('button[onclick^="startPayment("]:visible').count()==0)
        await logout()
        # --- driver arrives, marks done
        await login('0780222')
        await pg.click('.tabbar button[data-tab=mine]'); await pg.wait_for_timeout(300)
        await click_btn('providerArrive'); check('arrived', await pg.evaluate("__db.jobs[0].arrived")==True)
        await click_btn('providerMarkDone'); check('marked done', await pg.evaluate("__db.jobs[0].marked_done_by_provider")==True)
        await logout()
        # --- customer reports problem
        await login('0770111')
        await pg.click('.tabbar button[data-tab=mine]'); await pg.wait_for_timeout(300)
        await click_btn('startReport')
        await pg.fill('textarea[id^=reportInput]:visible','Skadad dörr'); await pg.wait_for_timeout(100)
        await click_btn('submitReport')
        check('problem stored', await pg.evaluate("__db.jobs[0].problem_text")=='Skadad dörr')
        await logout()
        # --- driver sees problem flag and responds
        await login('0780222')
        check('driver flag badge', (await pg.inner_text('#mineBadge')).strip()=='1')
        await pg.click('.tabbar button[data-tab=mine]'); await pg.wait_for_timeout(300)
        await pg.fill('textarea[id^=respondInput]:visible','Fanns redan'); await pg.wait_for_timeout(100)
        await click_btn('submitResponse')
        check('response stored', await pg.evaluate("__db.jobs[0].provider_response")=='Fanns redan')
        await logout()
        # --- admin
        await login('admin1')
        check('admin lands on admin', await screen()=='admin')
        check('admin sees 1 job card', await pg.locator('#adminList .card').count()==1)
        check('admin problem badge', (await pg.inner_text('#adminBadge')).strip()=='1')
        await pg.fill('#adminSearch','soffa'); await pg.wait_for_timeout(200)
        check('search finds', await pg.locator('#adminList .card').count()==1)
        await pg.fill('#adminSearch','zzz'); await pg.wait_for_timeout(200)
        check('search empty', await pg.locator('#adminList .card').count()==0)
        await pg.fill('#adminSearch',''); await pg.wait_for_timeout(200)
        await pg.fill('textarea[id^=admNote]:visible','intern'); await click_btn('saveAdminNote')
        check('admin note stored', await pg.evaluate("__db.admin_notes.length")==1)
        await click_btn('adminAsk'); await click_btn('adminDo')   # first action = release
        check('admin released', await pg.evaluate("__db.jobs[0].status")=='done' and await pg.evaluate("__db.jobs[0].resolution")=='released')
        check('payment released', await pg.evaluate("__db.payments.map(p=>p.status).join()")=='released')
        await click_btn('adminAsk'); await click_btn('adminDo')   # payout
        check('payment paid out', await pg.evaluate("__db.payments.map(p=>p.status).join()")=='paid_out')
        await pg.click('.tabbar button[data-tab=adminUsers]'); await pg.wait_for_timeout(500)
        check('users listed', await pg.locator('#adminUsersList .card').count()==3)
        await logout()
        # --- driver sees paid flag + history
        await login('0780222')
        check('driver paid badge on history', (await pg.inner_text('#historyBadge')).strip()=='1')
        await pg.click('.tabbar button[data-tab=history]'); await pg.wait_for_timeout(300)
        check('history has job', await pg.locator('#historyList .card').count()==1)
        # language switch
        await pg.click('#langSwitch button[data-lang=ar]'); await pg.wait_for_timeout(300)
        check('rtl', await pg.evaluate("document.documentElement.dir")=='rtl')
        # session restore
        await pg.reload(); await pg.wait_for_timeout(800)
        check('session restored', await pg.evaluate("document.getElementById('authOverlay').style.display")=='none')
        print('ERRORS:', errs)
        await b.close()
        sys.exit(0 if ok and not errs else 1)
asyncio.run(main())
