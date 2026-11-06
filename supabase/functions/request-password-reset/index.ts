// Edge Function: request-password-reset   (Deno / Supabase)
// Called by the apps (web, iPhone, Android) WITHOUT a signed-in user: { phone, lang }.
// Looks up the account's real e-mail (public.users.email), creates a one-time recovery token and mails the user a
// link to the web app: <PUBLIC_APP_URL>?reset_token=<token>. The web app exchanges the token (verifyOtp) and lets
// the user choose a new password. Always answers { ok: true } so nobody can find out which numbers are registered.
//
// Needs diz_password_reset.sql.
// Deploy:  supabase functions deploy request-password-reset --no-verify-jwt
// Secrets: supabase secrets set RESEND_API_KEY=re_... RESEND_FROM="Diz <no-reply@your-domain>" \
//                               PUBLIC_APP_URL=https://mohdconsulting.github.io/diz-app/
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MAX_PER_HOUR = 3;   // per phone number

type Lang = 'sv' | 'en' | 'ar';
const T: Record<Lang, { subject: string; hello: string; body: string; button: string; ignore: string }> = {
  sv: {
    subject: 'Återställ ditt lösenord – Diz',
    hello: 'Hej {name}!',
    body: 'Någon har bett om att återställa lösenordet för Diz-kontot med telefonnummer {phone}. Tryck på knappen för att välja ett nytt lösenord. Länken gäller i en timme och kan bara användas en gång.',
    button: 'Välj nytt lösenord',
    ignore: 'Om det inte var du kan du ignorera det här mejlet. Ditt lösenord ändras inte.',
  },
  en: {
    subject: 'Reset your password – Diz',
    hello: 'Hi {name},',
    body: 'Someone asked to reset the password for the Diz account with phone number {phone}. Tap the button to choose a new password. The link is valid for one hour and can only be used once.',
    button: 'Choose a new password',
    ignore: "If this wasn't you, you can ignore this e-mail. Your password will not change.",
  },
  ar: {
    subject: 'إعادة تعيين كلمة المرور – دز',
    hello: 'مرحبًا {name}،',
    body: 'طلب أحدهم إعادة تعيين كلمة المرور لحساب دز المرتبط برقم الهاتف {phone}. اضغط على الزر لاختيار كلمة مرور جديدة. الرابط صالح لمدة ساعة واحدة ويمكن استخدامه مرة واحدة فقط.',
    button: 'اختر كلمة مرور جديدة',
    ignore: 'إذا لم تكن أنت من طلب ذلك، يمكنك تجاهل هذه الرسالة. لن تتغير كلمة المرور.',
  },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Same normalisation as the apps' authEmail() and public.normalize_phone(). */
function normalizePhone(p: unknown): string {
  return String(p ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/** RESEND_FROM as typed in the dashboard: strips surrounding quotes, odd brackets and extra spaces.
 *  Returns null (and the caller logs the raw value) when it still isn't "a@b.c" or "Name <a@b.c>". */
function cleanFrom(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.normalize('NFKC').trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim()
    .replace(/[‹〈＜]/g, '<').replace(/[›〉＞]/g, '>')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')   // invisible direction/zero-width marks
    .replace(/\s+/g, ' ');
  const addr = '[^<>\\s@"]+@[^<>\\s@"]+\\.[^<>\\s@"]+';
  return new RegExp(`^(${addr}|[^<>@"]*<${addr}>)$`).test(s) ? s : null;
}

function mailHtml(lang: Lang, name: string, phone: string, link: string): string {
  const t = T[lang];
  const fill = (s: string) => esc(s).replace('{name}', esc(name)).replace('{phone}', esc(phone));
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html dir="${dir}" lang="${lang}"><body style="margin:0;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif;color:#17312b;">
<div style="max-width:480px;margin:0 auto;padding:28px 22px;background:#ffffff;">
  <p style="font-size:22px;font-weight:bold;color:#0f766e;margin:0 0 18px;">Diz · دز</p>
  <p style="font-size:15px;margin:0 0 10px;">${fill(t.hello)}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 22px;">${fill(t.body)}</p>
  <p style="margin:0 0 22px;"><a href="${esc(link)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;">${esc(t.button)}</a></p>
  <p style="font-size:12px;line-height:1.5;color:#5b6f69;margin:0 0 8px;">${esc(t.ignore)}</p>
  <p style="font-size:11px;color:#8a9a95;word-break:break-all;margin:0;">${esc(link)}</p>
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const lang: Lang = (['sv', 'en', 'ar'] as const).includes(body?.lang) ? body.lang : 'ar';
    const phone = normalizePhone(body?.phone);
    if (phone.length < 4) return json({ ok: true });

    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    // 1) Rate limit per number (also stops someone from flooding a user's inbox).
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from('password_reset_requests')
      .select('id', { count: 'exact', head: true }).eq('phone', phone).gte('requested_at', since);
    if ((count ?? 0) >= MAX_PER_HOUR) return json({ ok: true });
    await admin.from('password_reset_requests').insert({ phone });

    // 2) Who is it, and do they have an e-mail?
    const { data: rows, error: lookupErr } = await admin.rpc('password_reset_lookup', { p_phone: phone });
    if (lookupErr) { console.error('lookup failed', lookupErr); return json({ ok: true }); }
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.email) return json({ ok: true });

    // 3) One-time recovery token for the (internal) login e-mail of that account.
    const { data: authUser, error: userErr } = await admin.auth.admin.getUserById(row.id);
    if (userErr || !authUser?.user?.email) { console.error('auth user missing', userErr); return json({ ok: true }); }
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: authUser.user.email });
    const token = link?.properties?.hashed_token;
    if (linkErr || !token) { console.error('generateLink failed', linkErr); return json({ ok: true }); }

    const appUrl = new URL(Deno.env.get('PUBLIC_APP_URL') ?? 'https://mohdconsulting.github.io/diz-app/');
    appUrl.searchParams.set('reset_token', token);
    appUrl.searchParams.set('lang', lang);

    // 4) Send it with Resend.
    const rawFrom = Deno.env.get('RESEND_FROM');
    const from = cleanFrom(rawFrom);
    if (!from) {
      console.error('RESEND_FROM is not a valid sender. Use: Diz <no-reply@your-verified-domain>. Got:', JSON.stringify(rawFrom ?? null));
      return json({ ok: true });
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [row.email],
        subject: T[lang].subject,
        html: mailHtml(lang, row.name ?? '', String(body?.phone ?? ''), appUrl.toString()),
      }),
    });
    if (!res.ok) console.error('resend failed', res.status, await res.text());
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: true });
  }
});
