// Edge Function: send-push   (Deno / Supabase)
// Called by the database (pg_net, see diz_push.sql) for every row in push_outbox:
//   { id, user_id, kind, job_id, params, badge }  with header x-push-secret.
// Looks up the user's phones in push_tokens and sends the notification in each phone's language:
//   iPhone  → Apple Push Notification service (token-based auth with a .p8 key), badge = number on the app icon
//   Android → Firebase Cloud Messaging HTTP v1 (service account), notification_count = number on the icon
// Tokens that Apple/Google report as invalid are removed.
//
// Deploy:  supabase functions deploy send-push --no-verify-jwt
// Secrets: PUSH_SECRET              same value as push_config.secret in the database
//          APNS_KEY_P8              contents of AuthKey_XXXXXXXXXX.p8 (with BEGIN/END lines)
//          APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC (= bundle id, com.mohdconsulting.diz)
//          FCM_SERVICE_ACCOUNT      the whole Firebase service-account JSON
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Service and trade names (copied from src/i18n.ts) for notification texts.
const LABELS: Record<string, { services: Record<string, string>; cats: Record<string, string> }> = {
 "ar": {
  "services": {
   "junk": "التخلص من النفايات",
   "moving": "خدمة النقل",
   "pro": "احجز خدمة منزلية",
   "towing": "سحب السيارات"
  },
  "cats": {
   "electrician": "كهربائي",
   "plumber": "سباك",
   "smith": "حداد",
   "carpenter": "نجار",
   "appliance_repair": "مصلّح أجهزة منزلية",
   "ac_fridge": "فني تبريد وثلاجات",
   "cleaner": "عامل تنظيف منازل",
   "carpet_cleaning": "غسيل السجاد",
   "painter": "صباغ",
   "pest_control": "مكافحة الحشرات"
  }
 },
 "sv": {
  "services": {
   "junk": "Bli av med skräp",
   "moving": "Flytthjälp",
   "pro": "Boka en hemtjänst",
   "towing": "Bilbärgning"
  },
  "cats": {
   "electrician": "Elektriker",
   "plumber": "VVS",
   "smith": "Smed",
   "carpenter": "Snickare",
   "appliance_repair": "Vitvarureparatör",
   "ac_fridge": "AC och kylskåp",
   "cleaner": "Hemstädare",
   "carpet_cleaning": "Mattvätt",
   "painter": "Målare",
   "pest_control": "Skadedjursbekämpare"
  }
 },
 "en": {
  "services": {
   "junk": "Get rid of junk",
   "moving": "Moving help",
   "pro": "Book a home service",
   "towing": "Car towing"
  },
  "cats": {
   "electrician": "Electrician",
   "plumber": "Plumber",
   "smith": "Blacksmith/welder",
   "carpenter": "Carpenter",
   "appliance_repair": "Appliance repair",
   "ac_fridge": "AC & fridge repair",
   "cleaner": "Home cleaner",
   "carpet_cleaning": "Carpet cleaning",
   "painter": "Painter",
   "pest_control": "Pest control"
  }
 }
};

type Lang = 'ar' | 'en' | 'sv';
type Outbox = { id: number; user_id: string; kind: string; job_id?: string | null; params?: Record<string, unknown>; badge?: number };
type Token = { token: string; platform: 'ios' | 'android'; lang: Lang; env: 'production' | 'sandbox' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ---------- texts ----------
const T: Record<Lang, Record<string, [string, string]>> = {
  sv: {
    new_job: ['Nytt jobb: {what}', '{price} IQD – tryck för att se jobbet.'],
    new_offer: ['Nytt anbud', '{name} vill ta ditt jobb ({what}).'],
    assigned: ['Du fick jobbet!', 'Kunden har valt dig för {what}.'],
    arrived: ['Utföraren är på plats', 'Ditt jobb: {what}.'],
    marked_done: ['Jobbet är utfört', 'Bekräfta att {what} är klart.'],
    problem: ['Kunden har rapporterat ett problem', '{what} – öppna jobbet och svara.'],
    completed: ['Jobbet är avslutat', 'Kunden har bekräftat {what}. Tack!'],
    cancelled: ['Jobbet är avbokat', '{what}'],
    message: ['Meddelande från {name}', '{text}'],
  },
  en: {
    new_job: ['New job: {what}', '{price} IQD – tap to see the job.'],
    new_offer: ['New offer', '{name} wants to take your job ({what}).'],
    assigned: ['You got the job!', 'The customer chose you for {what}.'],
    arrived: ['Your provider has arrived', 'Your job: {what}.'],
    marked_done: ['The job is done', 'Please confirm that {what} is finished.'],
    problem: ['The customer reported a problem', '{what} – open the job and reply.'],
    completed: ['Job completed', 'The customer confirmed {what}. Thank you!'],
    cancelled: ['The job was cancelled', '{what}'],
    message: ['Message from {name}', '{text}'],
  },
  ar: {
    new_job: ['طلب جديد: {what}', '{price} دينار – اضغط لعرض الطلب.'],
    new_offer: ['عرض جديد', '{name} يريد تنفيذ طلبك ({what}).'],
    assigned: ['حصلت على الطلب!', 'اختارك الزبون لـ {what}.'],
    arrived: ['مقدم الخدمة وصل', 'طلبك: {what}.'],
    marked_done: ['تم إنجاز العمل', 'يرجى تأكيد إنهاء {what}.'],
    problem: ['أبلغ الزبون عن مشكلة', '{what} – افتح الطلب وقم بالرد.'],
    completed: ['اكتمل الطلب', 'أكد الزبون إنهاء {what}. شكرًا لك!'],
    cancelled: ['تم إلغاء الطلب', '{what}'],
    message: ['رسالة من {name}', '{text}'],
  },
};

export function text(lang: Lang, row: Outbox): { title: string; body: string } {
  const p = row.params ?? {};
  const l = LABELS[lang] ?? LABELS.ar;
  const service = String(p.service ?? ''), cat = p.cat ? String(p.cat) : '';
  const what = (service === 'pro' && cat && l.cats[cat]) ? l.cats[cat] : (l.services[service] ?? service);
  const price = typeof p.price === 'number' ? p.price.toLocaleString('en-US') : String(p.price ?? '');
  const vars: Record<string, string> = { what, price, name: String(p.name ?? ''), text: String(p.text ?? '') };
  if (row.kind === 'app_update') {
    const msg = String(p[lang === 'ar' ? 'ar' : 'en'] || p.en || p.ar || '');
    return { title: lang === 'ar' ? 'دز · تحديث جديد' : 'Diz · New version', body: msg };
  }
  const [t, b] = (T[lang] ?? T.ar)[row.kind] ?? ['Diz', ''];
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return { title: fill(t), body: fill(b) };
}

// ---------- JWT helpers (WebCrypto) ----------
const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const pemToDer = (pem: string) => {
  const b = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, ''));
  return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer;
};
export async function signJwt(header: object, payload: object, pem: string, alg: 'ES256' | 'RS256'): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(pem),
    alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign(alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

// Cached for the life of the function instance (Apple allows reuse for up to an hour, Google tokens last an hour).
let apnsJwt: { jwt: string; at: number } | null = null;
async function apnsToken(): Promise<string | null> {
  const p8 = Deno.env.get('APNS_KEY_P8'), kid = Deno.env.get('APNS_KEY_ID'), team = Deno.env.get('APNS_TEAM_ID');
  if (!p8 || !kid || !team) return null;
  if (apnsJwt && Date.now() - apnsJwt.at < 40 * 60_000) return apnsJwt.jwt;
  const jwt = await signJwt({ alg: 'ES256', kid }, { iss: team, iat: Math.floor(Date.now() / 1000) }, p8, 'ES256');
  apnsJwt = { jwt, at: Date.now() };
  return jwt;
}

let fcmAuth: { token: string; until: number; project: string } | null = null;
async function fcmAccess(): Promise<{ token: string; project: string } | null> {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  if (fcmAuth && Date.now() < fcmAuth.until) return fcmAuth;
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({ alg: 'RS256', typ: 'JWT' },
    { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 },
    sa.private_key, 'RS256');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) { console.error('fcm oauth failed', res.status, await res.text()); return null; }
  const data = await res.json();
  fcmAuth = { token: data.access_token, until: Date.now() + (data.expires_in - 120) * 1000, project: sa.project_id };
  return fcmAuth;
}

// ---------- senders: return false when the token is dead and should be removed ----------
async function sendApns(t: Token, msg: { title: string; body: string }, row: Outbox): Promise<boolean> {
  const jwt = await apnsToken();
  if (!jwt) { console.error('APNs secrets missing'); return true; }
  const host = t.env === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const res = await fetch(`https://${host}/3/device/${t.token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`, 'apns-topic': Deno.env.get('APNS_TOPIC') ?? 'com.mohdconsulting.diz',
      'apns-push-type': 'alert', 'apns-priority': '10',
    },
    body: JSON.stringify({ aps: { alert: msg, badge: row.badge ?? 1, sound: 'default' }, job_id: row.job_id ?? '', kind: row.kind }),
  });
  if (res.ok) return true;
  const err = await res.text();
  console.error('apns', res.status, err);
  return !(res.status === 410 || err.includes('BadDeviceToken') || err.includes('Unregistered'));
}

async function sendFcm(t: Token, msg: { title: string; body: string }, row: Outbox): Promise<boolean> {
  const auth = await fcmAccess();
  if (!auth) { console.error('FCM secret missing'); return true; }
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.project}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: {
      token: t.token,
      notification: msg,
      data: { job_id: String(row.job_id ?? ''), kind: row.kind, badge: String(row.badge ?? 1) },
      android: { priority: 'HIGH', notification: { channel_id: 'diz', notification_count: row.badge ?? 1, sound: 'default' } },
    } }),
  });
  if (res.ok) return true;
  const err = await res.text();
  console.error('fcm', res.status, err);
  return !(res.status === 404 || err.includes('UNREGISTERED') || err.includes('INVALID_ARGUMENT') && err.includes('token'));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!Deno.env.get('PUSH_SECRET') || req.headers.get('x-push-secret') !== Deno.env.get('PUSH_SECRET')) return json({ error: 'forbidden' }, 403);
  const row = await req.json().catch(() => null) as Outbox | null;
  if (!row?.user_id || !row.kind) return json({ error: 'bad request' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: tokens, error } = await admin.from('push_tokens').select('token,platform,lang,env').eq('user_id', row.user_id);
  if (error) { console.error(error); return json({ error: 'lookup failed' }, 500); }

  let sent = 0;
  const dead: string[] = [];
  for (const t of (tokens ?? []) as Token[]) {
    const msg = text(t.lang, row);
    try {
      const alive = t.platform === 'ios' ? await sendApns(t, msg, row) : await sendFcm(t, msg, row);
      if (alive) sent++; else dead.push(t.token);
    } catch (e) { console.error('send failed', e); }
  }
  if (dead.length) await admin.from('push_tokens').delete().in('token', dead);
  return json({ ok: true, sent, removed: dead.length });
});
