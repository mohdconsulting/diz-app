import { esc, toast, $ } from './util';
import { lang, sb, sbRef, role, currentUser } from './state';
import { currentScreen } from './shell';

/*
 * Support chat between a user and the admin (diz_support.sql). One thread per user.
 * Static inputs live in the template so typing survives re-renders; only the message log is redrawn.
 */

type Msg = { id: number; user_id: string; from_admin: boolean; body: string; created_at: string; read_at: string | null };
type Thread = { user_id: string; name: string; phone: string; role: string; last_body: string; last_from_admin: boolean; last_at: string; unread: number };

const TXT = {
  sv: { intro: 'Skriv till oss om du har frågor eller problem. Vi svarar här.', ph: 'Skriv ett meddelande…', send: 'Skicka', empty: 'Inga meddelanden än.',
        you: 'Du', staff: 'Diz support', back: '← Alla ärenden', none: 'Inga supportärenden.', reply: 'Svara…', user: 'Användare', failed: 'Kunde inte skicka. Försök igen.', many: 'För många meddelanden, vänta lite.' },
  en: { intro: 'Write to us if you have questions or problems. We reply here.', ph: 'Write a message…', send: 'Send', empty: 'No messages yet.',
        you: 'You', staff: 'Diz support', back: '← All conversations', none: 'No support conversations.', reply: 'Reply…', user: 'User', failed: 'Could not send. Try again.', many: 'Too many messages, wait a moment.' },
  ar: { intro: 'راسلنا إذا كان لديك سؤال أو مشكلة. سنرد هنا.', ph: 'اكتب رسالة…', send: 'إرسال', empty: 'لا توجد رسائل بعد.',
        you: 'أنت', staff: 'دعم دز', back: '→ كل المحادثات', none: 'لا توجد محادثات دعم.', reply: 'ردّ…', user: 'مستخدم', failed: 'تعذّر الإرسال. حاول مرة أخرى.', many: 'رسائل كثيرة، انتظر قليلًا.' },
};
const tx = () => TXT[lang];

let mine: Msg[] = [];
let threads: Thread[] = [];
let openUser: string | null = null;
let openMsgs: Msg[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let sending = false;

const fmt = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

function bubbles(list: Msg[], isMineFromAdmin: boolean): string {
  if(!list.length) return `<div class="chat-empty">${esc(tx().empty)}</div>`;
  return list.map(m => {
    const mineMsg = m.from_admin === isMineFromAdmin;
    const who = m.from_admin ? tx().staff : (isMineFromAdmin ? '' : tx().you);
    return `<div class="chat-msg ${mineMsg ? 'me' : 'them'}"><div class="chat-who">${esc(who)}${who ? ' · ' : ''}${fmt(m.created_at)}</div><div class="chat-body">${esc(m.body)}</div></div>`;
  }).join('');
}

function setBadge(id: string, n: number){
  const b = document.getElementById(id);
  if(b){ b.textContent = n > 9 ? '9+' : String(n); b.classList.toggle('show', n > 0); }
}

export async function loadSupport(){
  if(!sbRef || !currentUser) return;
  try{
    if(role === 'admin'){
      const { data, error } = await sb().rpc('admin_support_threads', {});
      if(error) throw error;
      threads = (data ?? []) as Thread[];
      if(openUser){
        const r = await sb().from('support_messages').select('*').eq('user_id', openUser);
        if(!r.error) openMsgs = ((r.data ?? []) as Msg[]).sort((a, b) => a.id - b.id);
        if(currentScreen() === 'adminSupport' && document.visibilityState === 'visible') void sb().rpc('mark_support_read', { p_user: openUser }).then(() => {}, () => {});
      }
    } else {
      const { data, error } = await sb().from('support_messages').select('*');
      if(error) throw error;
      mine = ((data ?? []) as Msg[]).sort((a, b) => a.id - b.id);
      if(currentScreen() === 'support' && document.visibilityState === 'visible' && mine.some(m => m.from_admin && !m.read_at)){
        mine = mine.map(m => m.from_admin && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m);
        void sb().rpc('mark_support_read', {}).then(() => {}, () => {});
      }
    }
    renderSupport();
  }catch(e){ console.error('support load failed', e); }
}

export function renderSupport(){
  if(!currentUser) return;
  const d = tx();
  if(role === 'admin'){
    setBadge('adminSupportBadge', threads.reduce((n, t) => n + Number(t.unread || 0), 0));
    $('supportBack').textContent = d.back;
    $<HTMLInputElement>('adminSupportInput').placeholder = d.reply;
    $('adminSupportSend').textContent = d.send;
    $('adminSupportThread').style.display = openUser ? 'block' : 'none';
    $('adminSupportList').style.display = openUser ? 'none' : 'block';
    if(openUser){
      const t = threads.find(x => x.user_id === openUser);
      $('supportThreadName').textContent = t ? `${t.name} · ${t.phone}` : d.user;
      const log = $('adminSupportLog');
      const near = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      const html = bubbles(openMsgs, true);
      if(log.innerHTML !== html){ log.innerHTML = html; if(near) log.scrollTop = log.scrollHeight; }
    } else {
      $('adminSupportList').innerHTML = threads.length ? threads.map(t =>
        `<div class="card" style="cursor:pointer;" onclick="openSupportThread('${t.user_id}')">
          <div style="display:flex;justify-content:space-between;gap:8px;"><b>${esc(t.name)}</b><span class="muted">${esc(fmt(t.last_at))}</span></div>
          <div class="muted">${esc(t.phone)}</div>
          <div style="margin-top:4px;">${t.last_from_admin ? '↩ ' : ''}${esc(t.last_body.slice(0, 120))}${Number(t.unread) ? ` <span class="tab-badge show" style="position:static;display:inline-block;">${t.unread}</span>` : ''}</div>
        </div>`).join('') : `<div class="empty">${esc(d.none)}</div>`;
    }
  } else {
    setBadge('supportBadge', mine.filter(m => m.from_admin && !m.read_at).length);
    $('supportIntro').textContent = d.intro;
    $<HTMLInputElement>('supportInput').placeholder = d.ph;
    $('supportSend').textContent = d.send;
    const log = $('supportLog');
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const html = bubbles(mine, false);
    if(log.innerHTML !== html){ log.innerHTML = html; if(near) log.scrollTop = log.scrollHeight; }
  }
}

export function openSupportScreen(name: string){
  if(name === 'adminSupport') openUser = null;
  renderSupport();
  void loadSupport();
}
export function openSupportThread(id: string){ openUser = id; openMsgs = []; renderSupport(); void loadSupport(); }
export function closeSupportThread(){ openUser = null; renderSupport(); void loadSupport(); }

async function post(fn: string, args: Record<string, unknown>, input: HTMLInputElement){
  const body = input.value.trim();
  if(!body || sending) return;
  sending = true;
  try{
    const { error } = await sb().rpc(fn, { ...args, p_body: body });
    if(error) throw error;
    input.value = '';
    await loadSupport();
    const log = $(role === 'admin' ? 'adminSupportLog' : 'supportLog'); log.scrollTop = log.scrollHeight;
  }catch(e){
    console.error('support send failed', e);
    toast(String((e as { message?: string })?.message || '').includes('too many') ? tx().many : tx().failed);
  }finally{ sending = false; input.focus({ preventScroll: true }); }
}
export function sendSupport(){ void post('send_support', {}, $<HTMLInputElement>('supportInput')); }
export function adminSendSupport(){ if(openUser) void post('admin_reply_support', { p_user: openUser }, $<HTMLInputElement>('adminSupportInput')); }

for(const id of ['supportInput', 'adminSupportInput']){
  document.addEventListener('keydown', e => {
    const el = e.target as HTMLElement | null;
    if(el?.id === id && (e as KeyboardEvent).key === 'Enter' && !(e as KeyboardEvent).isComposing){
      e.preventDefault(); if(id === 'supportInput') sendSupport(); else adminSendSupport();
    }
  });
}

export function startSupport(){
  stopSupport();
  if(!sbRef || !currentUser) return;
  void loadSupport();
  timer = setInterval(() => { void loadSupport(); }, 8000);
}
export function stopSupport(){
  if(timer){ clearInterval(timer); timer = null; }
  mine = []; threads = []; openMsgs = []; openUser = null;
  setBadge('supportBadge', 0); setBadge('adminSupportBadge', 0);
}
