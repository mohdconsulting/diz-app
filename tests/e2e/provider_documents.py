"""E2e: a provider uploads verification documents on the profile page; admin sees and opens them (diz_provider_documents.sql).
Usage:  npm run build && python3 tests/e2e/provider_documents.py"""
import asyncio, pathlib, sys, tempfile, os
from playwright.async_api import async_playwright
R = pathlib.Path(__file__).resolve().parent.parent.parent; E = R/'tests/e2e'; URL = (R/'index.html').as_uri()
res = []
def check(l, c): res.append(('PASS ' if c else '*** FAIL ') + l); print(res[-1], flush=True)
tmp = pathlib.Path(tempfile.mkdtemp())
(tmp/'id-card.png').write_bytes(b'\x89PNG\r\n\x1a\n' + b'0' * 2000)
(tmp/'certificate.pdf').write_bytes(b'%PDF-1.4\n' + b'0' * 3000)
(tmp/'notes.txt').write_text('hello')
with open(tmp/'huge.pdf', 'wb') as f: f.write(b'%PDF-1.4\n'); f.seek(11 * 1024 * 1024); f.write(b'0')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 420, 'height': 900}); pg = await ctx.new_page()
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
        docs = "window.__db.provider_documents"

        await register('Cust', '0700', 'customer')
        await pg.evaluate("goTo('mine')"); await pg.wait_for_timeout(300)
        check('customer has no documents section', not await pg.is_visible('#docsWrap'))
        await logout()

        await register('Welder', '0733', 'driver', 'smith')
        await pg.evaluate("goTo('mine')"); await pg.wait_for_timeout(300)
        check('provider sees documents section', await pg.is_visible('#docsWrap') and 'ID document for verification' in await pg.inner_text('#docsWrap'))
        check('empty list text', 'No documents uploaded yet' in await pg.inner_text('#docsList'))
        check('no document type choice', await pg.locator('#docKindSelect').count() == 0)
        check('camera and file buttons', await pg.inner_text('#docCameraBtn') == 'Take photo' and await pg.inner_text('#docFilesBtn') == 'Choose files')
        check('camera input opens the back camera', await pg.get_attribute('#docCameraInput', 'capture') == 'environment')
        check('file input allows several files', await pg.get_attribute('#docFileInput', 'multiple') is not None)
        await pg.set_input_files('#docFileInput', str(tmp/'notes.txt')); await pg.wait_for_timeout(400)
        check('text file refused', await pg.evaluate(docs + ".length") == 0)
        await pg.set_input_files('#docFileInput', str(tmp/'huge.pdf')); await pg.wait_for_timeout(400)
        check('file over 10 MB refused', await pg.evaluate(docs + ".length") == 0)
        # several files at once (front + back as PDF/image), then a photo from the camera input
        await pg.set_input_files('#docFileInput', [str(tmp/'id-card.png'), str(tmp/'certificate.pdf')]); await pg.wait_for_timeout(900)
        check('two files uploaded in one go', await pg.evaluate(docs + ".length") == 2)
        await pg.set_input_files('#docCameraInput', str(tmp/'id-card.png')); await pg.wait_for_timeout(700)
        rows = await pg.evaluate(docs)
        check('photo from camera uploaded', len(rows) == 3)
        check('all saved as ID documents', {r['kind'] for r in rows} == {'id'})
        uid = await pg.evaluate("window.__db.users.find(u=>u.phone==='0733').id")
        check('files stored in own folder', all(r['file_path'].startswith(uid + '/') for r in rows) and len(await pg.evaluate("Object.keys(window.__files)")) == 3)
        check('list shows all three', await pg.locator('#docsList .card').count() == 3)
        await pg.locator('#docsList .card').filter(has_text='certificate.pdf').locator('button').click(); await pg.wait_for_timeout(500)
        check('remove deletes row and file', await pg.evaluate(docs + ".length") == 2 and len(await pg.evaluate("Object.keys(window.__files)")) == 2)
        await logout()

        await login('admin1')
        await pg.evaluate("goTo('adminUsers')"); await pg.wait_for_timeout(500)
        card = pg.locator('#adminUsersList .card').filter(has_text='0733')
        check('admin sees the document', 'id-card.png' in await card.inner_text() and 'ID document' in await card.inner_text())
        async with ctx.expect_page() as popup:
            await card.locator('button:has-text("Open")').first.click()
        newp = await popup.value; await newp.wait_for_timeout(300)
        check('admin opens it via signed URL', 'signed/' in newp.url)
        await newp.close()
        cust = pg.locator('#adminUsersList .card').filter(has_text='0700')
        check('customer card has no documents block', 'Documents for verification' not in await cust.inner_text())

        await card.locator('button:has-text("Delete user")').click(); await pg.wait_for_timeout(200)
        await card.locator('.adm-confirm button.danger').click(); await pg.wait_for_timeout(500)
        check('deleting the user removes their files', len(await pg.evaluate("Object.keys(window.__files)")) == 0)

        check('no page errors', not errs)
        if errs: print(errs)
        await b.close()
asyncio.run(main())
sys.exit(1 if any(r.startswith('***') for r in res) else 0)
