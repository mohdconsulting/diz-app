"""E2e: "forgot password" with a code on WhatsApp (Edge Function whatsapp-reset, diz_whatsapp_reset.sql).
The fake backend accepts the code 123456; 000000 means expired.
Usage:  npm run build && python3 tests/e2e/whatsapp_reset.py"""
import asyncio, pathlib, sys
from playwright.async_api import async_playwright
R = pathlib.Path(__file__).resolve().parent.parent.parent; E = R/'tests/e2e'; URL = (R/'index.html').as_uri()
res = []
def check(l, c): res.append(('PASS ' if c else '*** FAIL ') + l); print(res[-1], flush=True)

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
        toast = lambda: pg.inner_text('#toast')

        # account without e-mail
        await pg.click('#authSwitchBtn')
        await pg.fill('#authNameInput', 'Ali'); await pg.fill('#authPhoneInput', '0770 123 4567'); await pg.fill('#authPassInput', 'oldpass1')
        await pg.click('#authRoleChips .chip[data-val=customer]')
        await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(700)
        await pg.click('#logoutBtn'); await pg.wait_for_timeout(300)

        await pg.fill('#authPhoneInput', '0770 123 4567')
        await pg.click('#authForgotBtn'); await pg.wait_for_timeout(200)
        check('whatsapp button shown', await pg.is_visible('#forgotWaBtn') and 'WhatsApp' in await pg.inner_text('#forgotWaBtn'))
        check('e-mail button still there', await pg.is_visible('#forgotSendBtn') and 'e-mail' in await pg.inner_text('#forgotSendBtn'))

        # WhatsApp not set up
        await pg.evaluate("window.__waUnavailable=true; window.__fnCalls=[]")
        await pg.click('#forgotWaBtn'); await pg.wait_for_timeout(300)
        check('unavailable: stays on forgot panel', await pg.is_visible('#authForgotWrap') and not await pg.is_visible('#authCodeWrap'))
        check('unavailable: toast', "isn't available" in await toast())
        await pg.evaluate("window.__waUnavailable=false; window.__fnCalls=[]")

        await pg.click('#forgotWaBtn'); await pg.wait_for_timeout(300)
        calls = await pg.evaluate("window.__fnCalls")
        check('send called', calls == [{'name': 'whatsapp-reset', 'body': {'action': 'send', 'phone': '0770 123 4567', 'lang': 'en'}}])
        check('code panel shown', await pg.is_visible('#authCodeWrap') and await pg.inner_text('#authTitle') == 'Enter the code')
        check('code note', 'WhatsApp' in await pg.inner_text('#codeNote'))

        # validation
        await pg.fill('#codeInput', '123'); await pg.fill('#codeNewInput', 'newpass1'); await pg.fill('#codeRepeatInput', 'newpass1')
        await pg.click('#codeSaveBtn'); await pg.wait_for_timeout(300)
        check('short code blocked', 'Wrong code' in await toast() and await pg.is_visible('#authCodeWrap'))
        await pg.fill('#codeInput', '123456'); await pg.fill('#codeRepeatInput', 'other12')
        await pg.click('#codeSaveBtn'); await pg.wait_for_timeout(300)
        check('mismatch blocked', "don't match" in await toast())
        await pg.fill('#codeRepeatInput', 'newpass1')
        await pg.fill('#codeInput', '654321'); await pg.click('#codeSaveBtn'); await pg.wait_for_timeout(400)
        check('wrong code', 'Wrong code' in await toast() and await pg.is_visible('#authCodeWrap'))
        await pg.fill('#codeInput', '000000'); await pg.click('#codeSaveBtn'); await pg.wait_for_timeout(400)
        check('expired code', 'expired' in await toast())

        # resend
        await pg.evaluate("window.__fnCalls=[]")
        await pg.click('#codeResendBtn'); await pg.wait_for_timeout(300)
        check('resend sends again', (await pg.evaluate("window.__fnCalls"))[0]['body']['action'] == 'send' and await pg.is_visible('#authCodeWrap'))

        # arabic-indic digits in the code are accepted
        await pg.fill('#codeInput', '١٢٣٤٥٦'); await pg.click('#codeSaveBtn'); await pg.wait_for_timeout(900)
        reset_call = [c for c in await pg.evaluate("window.__fnCalls") if c['body'].get('action') == 'reset'][-1]
        check('reset called with ascii code', reset_call['body'] == {'action': 'reset', 'phone': '0770 123 4567', 'code': '123456', 'password': 'newpass1'})
        check('signed in after reset', not await pg.is_visible('#authOverlay'))

        await pg.click('#logoutBtn'); await pg.wait_for_timeout(300)
        await pg.fill('#authPhoneInput', '0770 123 4567'); await pg.fill('#authPassInput', 'oldpass1'); await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(600)
        check('old password rejected', await pg.is_visible('#authOverlay'))
        await pg.fill('#authPassInput', 'newpass1'); await pg.click('#authSubmitBtn'); await pg.wait_for_timeout(700)
        check('new password works', not await pg.is_visible('#authOverlay'))

        # back button and arabic
        await pg.click('#logoutBtn'); await pg.wait_for_timeout(300)
        await pg.click('#authLangSwitch button[data-lang=ar]'); await pg.wait_for_timeout(200)
        await pg.click('#authForgotBtn'); await pg.wait_for_timeout(200)
        check('arabic whatsapp button', 'واتساب' in await pg.inner_text('#forgotWaBtn'))
        await pg.fill('#forgotPhoneInput', '0770 123 4567'); await pg.click('#forgotWaBtn'); await pg.wait_for_timeout(300)
        check('arabic code title', await pg.inner_text('#authTitle') == 'أدخل الرمز')
        await pg.click('#codeBackBtn'); await pg.wait_for_timeout(200)
        check('back keeps phone', await pg.is_visible('#authForgotWrap') and await pg.input_value('#forgotPhoneInput') == '0770 123 4567')

        check('no page errors' + ('' if not errs else ': ' + '; '.join(errs)), not errs)
        await b.close()
    fails = [r for r in res if 'FAIL' in r]
    print(f"\n{len(res)-len(fails)}/{len(res)} passed"); sys.exit(1 if fails else 0)
asyncio.run(main())
