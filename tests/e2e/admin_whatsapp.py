"""E2e: admin opens WhatsApp with a written message to a specific user (wa.me link, admin users tab).
Usage:  npm run build && python3 tests/e2e/admin_whatsapp.py"""
import asyncio, pathlib, sys
from playwright.async_api import async_playwright
R = pathlib.Path(__file__).resolve().parent.parent.parent; E = R/'tests/e2e'; URL = (R/'index.html').as_uri()
res = []
def check(l, c): res.append(('PASS ' if c else '*** FAIL ') + l); print(res[-1], flush=True)
def setdb(js): return "(()=>{const s=JSON.parse(sessionStorage.getItem('dbs')); const db=s.db; " + js + "; sessionStorage.setItem('dbs',JSON.stringify(s));})()"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 420, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script((E/'fake-webrtc.js').read_text())
        await pg.add_init_script("try{ if(!localStorage.getItem('diz_lang')) localStorage.setItem('diz_lang','en'); }catch(e){}")
        await pg.add_init_script("window.__opened=[]; window.open=(u)=>{ window.__opened.push(u); return null; };")
        await pg.route('**/@supabase/supabase-js@2', lambda r: r.fulfill(body=(E/'fake-supabase.js').read_text(), content_type='application/javascript'))
        await pg.route('**/fonts.g*/**', lambda r: r.abort())
        await pg.route('**/leaflet@*/**', lambda r: r.fulfill(body='', content_type='application/javascript'))
        await pg.goto(URL); await pg.wait_for_timeout(800)

        await pg.click('#authSwitchBtn')
        await pg.fill('#authNameInput', 'Ali'); await pg.fill('#authPhoneInput', '0770 123 4567'); await pg.fill('#authPassInput', 'secret1')
        await pg.click('#authRoleChips .chip[data-val=customer]')
        await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(700)
        await pg.click('#logoutBtn'); await pg.wait_for_timeout(300)

        await pg.fill('#authPhoneInput', 'admin1'); await pg.fill('#authPassInput', 'secret1')
        await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(800)
        await pg.evaluate("goTo('adminUsers')"); await pg.wait_for_timeout(400)
        card = pg.locator('#adminUsersList .card', has_text='Ali')
        btn = card.locator('button:has-text("WhatsApp")')
        check('whatsapp button on user', await btn.count() == 1)
        admin_card = pg.locator('#adminUsersList .card', has_text='Admin accounts')
        check('no whatsapp button on admin', await admin_card.locator('button:has-text("WhatsApp")').count() == 0)
        await btn.click(); await pg.wait_for_timeout(200)
        ta = card.locator('textarea')
        check('composer opens with greeting', await ta.input_value() == 'Hi Ali,\n')
        await ta.fill(''); await card.locator('button:has-text("Open in WhatsApp")').click(); await pg.wait_for_timeout(200)
        check('empty message blocked', await pg.evaluate("window.__opened.length") == 0)
        await ta.fill('Hi Ali,\nyour job & offer: 5 000 IQD?')
        await card.locator('button:has-text("Open in WhatsApp")').click(); await pg.wait_for_timeout(300)
        opened = await pg.evaluate("window.__opened")
        check('wa.me link with intl number and text', opened == ['https://wa.me/9647701234567?text=Hi%20Ali%2C%0Ayour%20job%20%26%20offer%3A%205%20000%20IQD%3F'])
        check('composer closed after send', await card.locator('textarea').count() == 0)
        # cancel
        await card.locator('button:has-text("WhatsApp")').click(); await pg.wait_for_timeout(200)
        await card.locator('button:has-text("Cancel")').click(); await pg.wait_for_timeout(200)
        check('cancel closes composer', await card.locator('textarea').count() == 0)
        # bad number
        await pg.evaluate(setdb("db.users.find(u=>u.name==='Ali').phone='12'"))
        await pg.reload(); await pg.wait_for_timeout(900)
        await pg.evaluate("goTo('adminUsers')"); await pg.wait_for_timeout(400)
        card = pg.locator('#adminUsersList .card', has_text='Ali')
        await card.locator('button:has-text("WhatsApp")').click(); await pg.wait_for_timeout(200)
        await pg.evaluate("window.__opened=[]")
        await card.locator('button:has-text("Open in WhatsApp")').click(); await pg.wait_for_timeout(300)
        check('bad number blocked', await pg.evaluate("window.__opened.length") == 0)
        check('no page errors', not errs) if not errs else check('no page errors: ' + '; '.join(errs), False)
        await b.close()
    fails = [r for r in res if 'FAIL' in r]
    print(f"\n{len(res)-len(fails)}/{len(res)} passed"); sys.exit(1 if fails else 0)
asyncio.run(main())
