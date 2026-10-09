import { toast, esc } from './util';
import { t, sb, sbRef, role, currentUser, jobs } from './state';
import { refreshCurrentScreen } from './shell';
import type { Job, ChatMessage } from './types';

/*
 * Chat between the customer and the provider of an assigned job.
 *  - Rules and permissions live in the database (diz_chat.sql): only the two parties write (rpc send_message), the admin may
 *    read, nothing can be edited or deleted from the client.
 *  - The panel's DOM node is created once and moved into the freshly rendered card after every screen render, so a
 *    half-written message, the scroll position and the keyboard focus survive the frequent re-renders.
 */

const POLL_MS = 7000;
const MAX_LEN = 1000;

type Row = Record<string, unknown>;
let messages: ChatMessage[] = [];
let loadedOnce = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let channel: ReturnType<ReturnType<typeof sb>['channel']> | null = null;
let openJobId: string | null = null;
let readonlyOpen = false;       // admin: view only

const me = () => currentUser?.phone ?? '';
function rowToMessage(r: Row): ChatMessage {
  return { id: Number(r.id), jobId: r.job_id as string, senderPhone: r.sender_phone as string, recipientPhone: r.recipient_phone as string,
    body: r.body as string, createdAt: Number(r.created_at), readAt: r.read_at == null ? null : Number(r.read_at) };
}

export const unreadFor = (jobId: string) => messages.filter(m => m.jobId === jobId && m.recipientPhone === me() && m.readAt == null).length;
export const unreadTotal = () => messages.filter(m => m.recipientPhone === me() && m.readAt == null).length;

export async function loadMessages(){
  if(!sbRef || !currentUser) return;
  try{
    const { data, error } = await sb().from('messages').select('*');
    if(error) throw error;
    const next = (data as Row[]).map(rowToMessage).sort((a, b) => a.id - b.id);
    const known = new Set(messages.map(m => m.id));
    const incoming = next.filter(m => !known.has(m.id) && m.recipientPhone === me());
    const changed = JSON.stringify(next) !== JSON.stringify(messages);
    messages = next;
    if(loadedOnce && incoming.length && !(openJobId === incoming[incoming.length - 1].jobId && document.visibilityState === 'visible')){
      toast(t().chat.newToast);
      try{ if(navigator.vibrate) navigator.vibrate(150); }catch(e){ /* optional */ }
    }
    loadedOnce = true;
    if(changed) refreshCurrentScreen();
    void markReadIfViewing();
  }catch(e){ console.error('messages load failed', e); }
}

let marking = false;
/** Tells the database that the open conversation has been seen (only the recipient's own unread messages change). */
async function markReadIfViewing(){
  if(!openJobId || readonlyOpen || marking || document.visibilityState !== 'visible' || !unreadFor(openJobId)) return;
  marking = true;
  try{
    const { error } = await sb().rpc('mark_messages_read', { p_job_id: openJobId });
    if(error) throw error;
    const now = Date.now();
    messages = messages.map(m => m.jobId === openJobId && m.recipientPhone === me() && m.readAt == null ? { ...m, readAt: now } : m);
    refreshCurrentScreen();
  }catch(e){ console.error('mark read failed', e); }
  finally{ marking = false; }
}

export function startChat(){
  stopChat();
  if(!sbRef || !currentUser || role === 'admin') return;
  void loadMessages();
  pollTimer = setInterval(() => { void loadMessages(); }, POLL_MS);
  channel = sb().channel('messages-' + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => { void loadMessages(); })
    .subscribe();
}
export function stopChat(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  if(channel && sbRef){ sb().removeChannel(channel); channel = null; }
  messages = []; loadedOnce = false; openJobId = null; readonlyOpen = false;
  destroyNode();
}

/** Admin reads a conversation on demand (no polling). */
export async function adminLoadChat(jobId: string){
  if(!sbRef) return;
  try{
    const { data, error } = await sb().from('messages').select('*').eq('job_id', jobId);
    if(error) throw error;
    messages = (data as Row[]).map(rowToMessage).sort((a, b) => a.id - b.id);
  }catch(e){ console.error('admin chat load failed', e); }
}

// ---------------- the card block ----------------
export function toggleChat(jobId: string){
  const closing = openJobId === jobId;
  openJobId = closing ? null : jobId;
  readonlyOpen = false;
  if(closing) destroyNode();
  refreshCurrentScreen();
  if(!closing) void markReadIfViewing();
}
export async function toggleAdminChat(jobId: string){
  const closing = openJobId === jobId;
  openJobId = closing ? null : jobId;
  readonlyOpen = true;
  if(closing) destroyNode(); else await adminLoadChat(jobId);
  refreshCurrentScreen();
}

/** The button (with unread count) and, when open, the slot that the panel is mounted into. `admin` = read-only view. */
export function chatHTML(j: Job, admin = false): string {
  const d = t().chat, open = openJobId === j.id;
  const n = admin ? 0 : unreadFor(j.id);
  const label = open ? d.closeBtn : (n ? d.openUnreadBtn.replace('{n}', String(n)) : d.openBtn);
  return `<div class="chat-block"><div class="action-row">
      <button class="secondary${n && !open ? ' has-unread' : ''}" onclick="${admin ? 'toggleAdminChat' : 'toggleChat'}('${j.id}')">💬 ${label}</button>
    </div>${open ? `<div class="chat-slot" id="chatSlot-${j.id}"></div>` : ''}</div>`;
}

// ---------------- the persistent panel ----------------
let node: HTMLDivElement | null = null;
let logEl: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let sendBtn: HTMLButtonElement | null = null;
let wantFocus = false;
let sending = false;
let sentCount = -1;

// Focus is only given up by a real interaction elsewhere (tap/click or focusing another field). A blur caused by the panel being
// detached during a re-render is not one, so the panel can take the focus back after the render.
const outside = (e: Event) => { if(node && !node.contains(e.target as Node)) wantFocus = false; };
document.addEventListener('pointerdown', outside, true);
document.addEventListener('focusin', outside, true);

function destroyNode(){ if(node) node.remove(); node = logEl = inputEl = sendBtn = null; sentCount = -1; wantFocus = false; }

function buildNode(){
  node = document.createElement('div'); node.className = 'chat-panel';
  logEl = document.createElement('div'); logEl.className = 'chat-log';
  const form = document.createElement('div'); form.className = 'chat-form';
  inputEl = document.createElement('input'); inputEl.type = 'text'; inputEl.maxLength = MAX_LEN; inputEl.autocomplete = 'off';
  sendBtn = document.createElement('button'); sendBtn.className = 'secondary'; sendBtn.type = 'button';
  const note = document.createElement('div'); note.className = 'chat-note';
  form.append(inputEl, sendBtn);
  node.append(logEl, form, note);
  inputEl.addEventListener('focus', () => { wantFocus = true; });
  inputEl.addEventListener('keydown', e => { if(e.key === 'Enter' && !e.isComposing){ e.preventDefault(); void sendMessage(); } });
  sendBtn.addEventListener('click', () => { void sendMessage(); });
}

const fmtClock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ts: number) => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });

/** Called after every screen render: move the panel into its slot and refresh the message list. */
export function mountChat(){
  if(!openJobId) return;
  const slot = document.getElementById('chatSlot-' + openJobId);
  if(!slot){ return; }
  const j = jobs.find(x => x.id === openJobId);
  const d = t().chat;
  if(!node) buildNode();
  if(!node || !logEl || !inputEl || !sendBtn) return;
  if(node.parentElement !== slot) slot.appendChild(node);
  const list = messages.filter(m => m.jobId === openJobId);
  const mineChat = !readonlyOpen;
  const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  let last = '';
  const items = list.map(m => {
    const day = fmtDay(m.createdAt);
    const sep = day !== last ? `<div class="chat-day">${esc(day)}</div>` : '';
    last = day;
    const mine = mineChat && m.senderPhone === me();
    const fromCustomer = j ? m.senderPhone === j.ownerPhone : false;
    const who = mine ? d.you : (fromCustomer ? d.customer : d.provider);
    return `${sep}<div class="chat-msg ${mine ? 'me' : 'them'}"><div class="chat-who">${esc(who)} · ${fmtClock(m.createdAt)}</div><div class="chat-body">${esc(m.body)}</div></div>`;
  }).join('');
  logEl.innerHTML = items || `<div class="chat-empty">${esc(d.empty)}</div>`;
  const closed = !j || j.status !== 'accepted';
  const form = node.querySelector<HTMLElement>('.chat-form');
  if(form) form.style.display = (mineChat && !closed) ? 'flex' : 'none';
  inputEl.placeholder = d.placeholder; sendBtn.textContent = d.sendBtn; sendBtn.disabled = sending;
  const note = node.querySelector<HTMLElement>('.chat-note');
  if(note) note.textContent = readonlyOpen ? d.adminView : (closed ? d.closed : d.privacy);
  if(nearBottom || list.length !== sentCount) logEl.scrollTop = logEl.scrollHeight;
  sentCount = list.length;
  if(wantFocus && mineChat && !closed) inputEl.focus({ preventScroll: true });
}

async function sendMessage(){
  if(!inputEl || !openJobId || sending) return;
  const body = inputEl.value.trim();
  if(!body) return;
  sending = true; if(sendBtn) sendBtn.disabled = true;
  try{
    const { error } = await sb().rpc('send_message', { p_job_id: openJobId, p_body: body });
    if(error) throw error;
    if(inputEl) inputEl.value = '';
    await loadMessages();
  }catch(e){
    console.error('send failed', e);
    const msg = String((e as { message?: string })?.message || '');
    toast(msg.includes('too many') ? t().chat.tooMany : t().chat.failed);
  }finally{
    sending = false; if(sendBtn) sendBtn.disabled = false;
    if(inputEl){ wantFocus = true; inputEl.focus({ preventScroll: true }); }
  }
}
