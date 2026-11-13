"""E2e: providers must add a profile photo (camera or file) before making offers; customers and admin see it
(diz_provider_avatar.sql).   Usage:  npm run build && python3 tests/e2e/provider_avatar.py"""
import asyncio, pathlib, sys, tempfile
from PIL import Image
from playwright.async_api import async_playwright
R = pathlib.Path(__file__).resolve().parent.parent.parent; E = R/'tests/e2e'; URL = (R/'index.html').as_uri()
res = []
def check(l, c): res.append(('PASS ' if c else '*** FAIL ') + l); print(res[-1], flush=True)
def setdb(js): return "(()=>{const s=JSON.parse(sessionStorage.getItem('dbs')); const db=s.db; " + js + "; sessionStorage.setItem('dbs',JSON.stringify(s));})()"
DB = "JSON.parse(sessionStorage.getItem('dbs')).db"
tmp = pathlib.Path(tempfile.mkdtemp())
Image.new('RGB', (1200, 800), (30, 120, 90)).save(tmp/'face.jpg', quality=90)
(tmp/'notes.txt').write_text('hello')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 420, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script((E/'fake-webrtc.js').read_text())
        await pg.add_init_script("try{ if(!localStorage.getItem('diz_lang')) localStorage.setItem('diz_lang','en'); }catch(e){}")
        await pg.route('**/@supabase/supabase-js@2', lambda r: r.fulfill(body=(E/'fake-supabase.js').read_text(), content_type='application/javascript'))
        await pg.route('**/fonts.g*/**', lambda r: r.abort())
        await pg.route('**/leaflet@*/**', lambda r: r.fulfill(body='', content_type='application/javascript'))
        await pg.route('https://fake.supabase.co/**', lambda r: r.fulfill(path=str(tmp/'face.jpg'), content_type='image/jpeg'))
        await pg.goto(URL); await pg.wait_for_timeout(800)

        async def register(name, phone, role, prof=None):
            await pg.click('#authSwitchBtn')
            await pg.fill('#authNameInput', name); await pg.fill('#authPhoneInput', phone); await pg.fill('#authPassInput', 'secret1')
            await pg.click(f'#authRoleChips .chip[data-val={role}]')
            if prof: await pg.click(f'#authProfileChips .chip[data-val={prof}]')
            await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(700)
        async def login(phone):
            await pg.fill('#authPhoneInput', phone); await pg.fill('#authPassInput', 'secret1')
            await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(800)
        async def logout():
            await pg.click('#logoutBtn'); await pg.wait_for_timeout(300)

        await register('Cust', '0700', 'customer')
        await pg.evaluate("goTo('new')"); await pg.wait_for_timeout(200)
        await pg.click('#serviceChips .chip[data-val=pro]'); await pg.click('#catChips .chip[data-val=painter]')
        await pg.fill('#descInput', 'Paint the hall'); await pg.fill('#addrInput', 'Street 1'); await pg.fill('#customPriceInput', '30000')
        await pg.click('#submitBtn'); await pg.wait_for_timeout(600)
        await pg.evaluate("goTo('mine')"); await pg.wait_for_timeout(200)
        check('customer has no photo section', not await pg.is_visible('#avatarWrap'))
        await logout()

        # provider on a database with the column: no photo yet
        await register('Painter', '0722', 'driver', 'painter')
        await pg.evaluate(setdb("db.users.find(u=>u.phone==='0722').avatar_url=null")); await pg.reload(); await pg.wait_for_timeout(900)
        check('photo banner shown', await pg.is_visible('#photoNudge') and 'profile photo' in await pg.inner_text('#photoNudge'))
        await pg.evaluate("goTo('jobs')"); await pg.wait_for_timeout(300)
        card = await pg.inner_text('#jobsList')
        check('job visible but offer needs photo', 'Paint the hall' in card or 'Painter' in card)
        check('no offer button without photo', 'Add a profile photo to be able to make offers' in card and await pg.locator('#jobsList [id^=offerInput-]').count() == 0)
        n = await pg.evaluate(DB + ".jobs[0].id")
        await pg.evaluate(f"submitOffer('{n}')"); await pg.wait_for_timeout(400)
        check('offer refused without photo', await pg.evaluate("(" + DB + ".jobs[0].applicants||[]).length") == 0)

        await pg.click('#photoNudgeBtn'); await pg.wait_for_timeout(300)
        check('banner opens photo card', await pg.is_visible('#avatarWrap') and await pg.inner_text('#avatarRequired') == 'Required')
        check('front camera', await pg.get_attribute('#avatarCameraInput', 'capture') == 'user')
        check('placeholder letter', await pg.inner_text('#avatarPreview') == 'P')
        await pg.set_input_files('#avatarFileInput', str(tmp/'notes.txt')); await pg.wait_for_timeout(400)
        check('non-image refused', 'Choose an image' in await pg.inner_text('#toast'))
        await pg.set_input_files('#avatarCameraInput', str(tmp/'face.jpg')); await pg.wait_for_timeout(1200)
        url = await pg.evaluate(DB + ".users.find(u=>u.phone==='0722').avatar_url")
        uid = await pg.evaluate(DB + ".users.find(u=>u.phone==='0722').id")
        check('photo saved to own folder', bool(url) and f'/object/public/avatars/{uid}/' in url and url.endswith('.jpg'))
        files = await pg.evaluate("window.__files")
        f = [v for k, v in files.items() if k.startswith('avatars/')]
        check('resized jpeg uploaded', len(f) == 1 and f[0]['type'] == 'image/jpeg' and f[0]['size'] < 200000)
        check('preview shows photo', await pg.locator('#avatarPreview img').count() == 1 and await pg.inner_text('#avatarRequired') == '')
        check('banner gone', not await pg.is_visible('#photoNudge'))
        await pg.set_input_files('#avatarFileInput', str(tmp/'face.jpg')); await pg.wait_for_timeout(1200)
        files = await pg.evaluate("window.__files")
        check('changing photo removes the old file', len([k for k in files if k.startswith('avatars/')]) == 1)

        await pg.evaluate("goTo('jobs')"); await pg.wait_for_timeout(300)
        await pg.evaluate(f"submitOffer('{n}')"); await pg.wait_for_timeout(500)
        check('offer works with photo', await pg.evaluate("(" + DB + ".jobs[0].applicants||[]).length") == 1)
        await logout()

        # customer sees the photo with the offer and on the accepted job
        await login('0700')
        await pg.evaluate("goTo('mine')"); await pg.wait_for_timeout(600)
        img = pg.locator('#mineList .who img.avatar')
        check('customer sees provider photo on offer', await img.count() >= 1)
        await pg.evaluate(f"assignJob('{n}','0722')"); await pg.wait_for_timeout(800)
        await pg.evaluate("goTo('mine')"); await pg.wait_for_timeout(600)
        line = pg.locator('#mineList .provider-line')
        check('accepted job shows provider with photo', await line.count() == 1 and 'Painter' in await line.inner_text() and await line.locator('img.avatar').count() == 1)
        await logout()

        # admin sees the photo
        await login('admin1')
        await pg.evaluate("goTo('adminUsers')"); await pg.wait_for_timeout(500)
        prov = pg.locator('#adminUsersList .card', has_text='Painter')
        check('admin sees provider photo', await prov.locator('img.avatar').count() == 1)

        # old database without the column: no requirement
        await logout()
        await register('Old', '0733', 'driver', 'painter')
        await pg.evaluate("goTo('jobs')"); await pg.wait_for_timeout(300)
        check('no photo requirement without the column', not await pg.is_visible('#photoNudge'))

        check('no page errors' + ('' if not errs else ': ' + '; '.join(errs)), not errs)
        await b.close()
    fails = [r for r in res if 'FAIL' in r]
    print(f"\n{len(res)-len(fails)}/{len(res)} passed"); sys.exit(1 if fails else 0)
asyncio.run(main())
