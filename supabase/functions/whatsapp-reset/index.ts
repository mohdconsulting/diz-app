// Edge Function: whatsapp-reset   (Deno / Supabase)
// "Forgot password" with a one-time code on WhatsApp (WhatsApp Cloud API from Meta, authentication template).
// Called by the apps (web, iPhone, Android) WITHOUT a signed-in user.
//
//   { action: 'send',  phone, lang }             -> { ok: true }   (always, so nobody can find out which numbers exist)
//                                                   { ok: false, error: 'unavailable' } when WhatsApp isn't set up
//   { action: 'reset', phone, code, password }   -> { ok: true } | { ok: false, error: 'invalid'|'expired'|'too_many'|'weak' }
//
// Needs diz_password_reset.sql and diz_whatsapp_reset.sql.
// Deploy (dashboard editor or CLI):  supabase functions deploy whatsapp-reset --no-verify-jwt
// Secrets: WHATSAPP_TOKEN     permanent system-user token (Meta Business settings -> System users)
//          WHATSAPP_PHONE_ID  "Phone number ID" from WhatsApp -> API Setup
//          WHATSAPP_TEMPLATE  name of the approved Authentication template (default diz_reset_code)
//          WHATSAPP_API_VERSION  optional, default v23.0
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const CODE_MINUTES = 10;
type Lang = 'sv' | 'en' | 'ar';

/** Same normalisation as public.normalize_phone() and the apps' authEmail(). */
export function normalizePhone(p: unknown): string {
  return String(p ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/** Number as WhatsApp wants it: digits with country code. Local Iraqi numbers (07…, 7…) get 964. */
export function waNumber(p: unknown): string | null {
  let n = normalizePhone(p).replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = '964' + n.slice(1);
  else if (n.length === 10 && n.startsWith('7')) n = '964' + n;
  return n.length >= 8 && n.length <= 15 ? n : null;
}

export function newCode(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, '0');
}

export async function hashCode(phone: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`diz-reset:${normalizePhone(phone)}:${code}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Template languages to try, best first. Meta answers 132001 when the template has no such language. */
export function templateLangs(lang: Lang): string[] {
  const first = lang === 'ar' ? 'ar' : lang === 'sv' ? 'sv' : 'en_GB';
  return [...new Set([first, 'en_GB', 'en_US', 'en', 'ar'])];
}

/** Body of a WhatsApp "copy code" authentication template message. */
export function templateMessage(to: string, template: string, langCode: string, code: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: langCode },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  };
}

async function sendWhatsApp(to: string, code: string, lang: Lang): Promise<boolean> {
  const token = Deno.env.get('WHATSAPP_TOKEN')!;
  const phoneId = Deno.env.get('WHATSAPP_PHONE_ID')!;
  const template = Deno.env.get('WHATSAPP_TEMPLATE') || 'diz_reset_code';
  const version = Deno.env.get('WHATSAPP_API_VERSION') || 'v23.0';
  for (const lc of templateLangs(lang)) {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(templateMessage(to, template, lc, code)),
    });
    if (res.ok) return true;
    const err = await res.json().catch(() => ({}));
    const codeNo = err?.error?.code;
    console.error('whatsapp send failed', lc, res.status, JSON.stringify(err?.error ?? err));
    if (codeNo !== 132001) return false;   // only "no such template language" is worth another try
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const lang: Lang = (['sv', 'en', 'ar'] as const).includes(body?.lang) ? body.lang : 'ar';
    const phone = normalizePhone(body?.phone);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } });

    if (action === 'send') {
      if (!Deno.env.get('WHATSAPP_TOKEN') || !Deno.env.get('WHATSAPP_PHONE_ID')) {
        console.error('WhatsApp is not set up: add the secrets WHATSAPP_TOKEN and WHATSAPP_PHONE_ID');
        return json({ ok: false, error: 'unavailable' });
      }
      if (phone.length < 4) return json({ ok: true });
      const to = waNumber(body?.phone);
      if (!to) return json({ ok: true });
      const { data: rows, error: lookupErr } = await admin.rpc('password_reset_lookup', { p_phone: phone });
      if (lookupErr) { console.error('lookup failed', lookupErr); return json({ ok: true }); }
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row?.id) return json({ ok: true });
      const code = newCode();
      const { data: stored, error: storeErr } = await admin.rpc('password_reset_store_code',
        { p_user: row.id, p_phone: phone, p_hash: await hashCode(phone, code), p_minutes: CODE_MINUTES });
      if (storeErr) { console.error('store failed', storeErr); return json({ ok: true }); }
      if (stored !== true) return json({ ok: true });   // rate limited (3 per hour)
      await sendWhatsApp(to, code, lang);
      return json({ ok: true });
    }

    if (action === 'reset') {
      const code = String(body?.code ?? '').replace(/\D/g, '');
      const password = String(body?.password ?? '');
      if (password.length < 6) return json({ ok: false, error: 'weak' });
      if (phone.length < 4 || code.length !== 6) return json({ ok: false, error: 'invalid' });
      const { data: rows, error: checkErr } = await admin.rpc('password_reset_check_code',
        { p_phone: phone, p_hash: await hashCode(phone, code) });
      if (checkErr) { console.error('check failed', checkErr); return json({ ok: false, error: 'invalid' }); }
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row?.status !== 'ok' || !row.user_id) return json({ ok: false, error: row?.status ?? 'invalid' });
      const { error: updErr } = await admin.auth.admin.updateUserById(row.user_id, { password });
      if (updErr) { console.error('password update failed', updErr); return json({ ok: false, error: 'invalid' }); }
      return json({ ok: true });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: 'invalid' });
  }
});
