import { toast, safeGetLocal } from './util';
import { t, sb, sbRef, role, currentUser, jobs } from './state';
import type { Job } from './types';

/*
 * Voice calls between the customer and the provider of an assigned job (WebRTC, audio only).
 *  - The audio goes directly between the two browsers. The database only carries the signalling (rpc send_call_signal,
 *    table call_signals — see diz_calls.sql): offer, answer, ICE candidates and "end". Phone numbers are never shown.
 *  - STUN servers find each side's public address. Some mobile networks block direct connections; those calls need a
 *    TURN relay: add one to TURN_SERVERS below (it costs money — Cloudflare, Twilio, or your own coturn).
 *  - A call can only be received while the app is open (a web page cannot ring in the background).
 *  - The call UI is a floating panel that lives outside the screens, so screen re-renders never interrupt a call.
 */

const STUN_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
/** Example: [{ urls: 'turn:turn.example.com:3478', username: '…', credential: '…' }]. Leave empty to run with STUN only. */
const TURN_SERVERS: RTCIceServer[] = [];

const RING_TIMEOUT_MS = 45000;      // unanswered calls stop ringing after this
const CONNECT_TIMEOUT_MS = 20000;   // after answering, give up if no audio connection is made
const POLL_IDLE_MS = 5000, POLL_BUSY_MS = 1500;

type Row = Record<string, unknown>;
interface Signal { id: number; jobId: string; from: string; callId: string; kind: 'offer' | 'answer' | 'ice' | 'end'; payload: string | null }
type Phase = 'calling' | 'incoming' | 'connecting' | 'active';
interface Call {
  id: string; jobId: string; peer: string; phase: Phase; outgoing: boolean;
  pc: RTCPeerConnection | null; local: MediaStream | null; muted: boolean;
  pendingOffer: string | null; pendingIce: string[]; startedAt: number | null; timer: ReturnType<typeof setTimeout> | null;
  sendQueue: Promise<unknown>;   // signals of one call are sent strictly one after the other (offer/answer before candidates)
}

let call: Call | null = null;
let seenIds = new Set<number>();   // signals already handled (rows can become visible out of id order, so a max id is not enough)
const earlyIce = new Map<string, string[]>();   // candidates that arrived before their offer
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let channel: ReturnType<ReturnType<typeof sb>['channel']> | null = null;
let polling = false;
let ringTimer: ReturnType<typeof setInterval> | null = null;
let audioCtx: AudioContext | null = null;

// Calls this device has already dealt with. A signal stays readable for 90 s, so after a reload or re-login an answered or
// declined call would otherwise ring again.
const HANDLED_KEY = 'diz_calls_handled';
function handledIds(): string[] { try{ return JSON.parse(safeGetLocal(HANDLED_KEY) || '[]') as string[]; }catch(e){ return []; } }
const wasHandled = (id: string) => handledIds().includes(id);
function markHandled(id: string){ try{ localStorage.setItem(HANDLED_KEY, JSON.stringify([...handledIds(), id].slice(-30))); }catch(e){ /* optional */ } }

const me = () => currentUser?.phone ?? '';
const newId = () => 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
export const callsSupported = () => !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

/** Who is on the other end of this job, if I am one of the two parties and the job is active. */
export function peerOf(j: Job): string | null {
  if(!currentUser || role === 'admin' || j.status !== 'accepted' || !j.acceptedByPhone) return null;
  if(j.ownerPhone === me()) return j.acceptedByPhone;
  if(j.acceptedByPhone === me()) return j.ownerPhone;
  return null;
}

// ---------------- signalling ----------------
async function signal(jobId: string, callId: string, kind: Signal['kind'], payload: string | null){
  const { error } = await sb().rpc('send_call_signal', { p_job_id: jobId, p_call_id: callId, p_kind: kind, p_payload: payload });
  if(error) throw error;
}
/** Sends a signal after all earlier ones of the same call have been stored. Without this the candidates, which the browser
 *  produces right after the offer, can overtake it on a slow network and reach the other side before the call exists. */
function enqueue(c: Call, kind: Signal['kind'], payload: string | null): Promise<void> {
  const run = c.sendQueue.then(() => signal(c.jobId, c.id, kind, payload));
  c.sendQueue = run.catch(() => {});
  return run;
}
const toSignal = (r: Row): Signal => ({ id: Number(r.id), jobId: r.job_id as string, from: r.from_phone as string, callId: r.call_id as string,
  kind: r.kind as Signal['kind'], payload: (r.payload as string | null) ?? null });

async function fetchSignals(){
  if(!sbRef || !currentUser || polling) return;
  polling = true;
  try{
    const { data, error } = await sb().from('call_signals').select('*');
    if(error) throw error;
    const all = (data as Row[]).map(toSignal);
    const fresh = all.filter(s => !seenIds.has(s.id)).sort((a, b) => a.id - b.id);
    for(const s of fresh){ seenIds.add(s.id); await handleSignal(s); }
    seenIds = new Set([...seenIds].filter(id => all.some(s => s.id === id)));   // expired rows no longer need remembering
  }catch(e){ console.error('call signals failed', e); }
  finally{ polling = false; }
}
function schedulePoll(){
  if(pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => { await fetchSignals(); if(sbRef && currentUser) schedulePoll(); }, call ? POLL_BUSY_MS : POLL_IDLE_MS);
}
export function startCalls(){
  stopCalls();
  if(!sbRef || !currentUser || role === 'admin') return;
  void fetchSignals(); schedulePoll();
  channel = sb().channel('calls-' + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals' }, () => { void fetchSignals(); })
    .subscribe();
}
export function stopCalls(){
  if(pollTimer){ clearTimeout(pollTimer); pollTimer = null; }
  if(channel && sbRef){ sb().removeChannel(channel); channel = null; }
  if(call) void endCall(true, false);
  seenIds = new Set(); earlyIce.clear();
}

async function handleSignal(s: Signal){
  if(s.kind === 'offer'){
    if(wasHandled(s.callId)) return;
    if(call){   // already busy (another call, or the same one re-sent): refuse politely
      if(call.id !== s.callId) void signal(s.jobId, s.callId, 'end', 'busy').catch(() => {});
      return;
    }
    const j = jobs.find(x => x.id === s.jobId);
    if(!j || peerOf(j) !== s.from) return;
    call = newCall(s.callId, s.jobId, s.from, 'incoming', false);
    call.pendingOffer = s.payload;
    call.pendingIce = earlyIce.get(s.callId) ?? []; earlyIce.delete(s.callId);
    call.timer = setTimeout(() => { if(call && call.phase === 'incoming') void endCall(false, false); }, RING_TIMEOUT_MS);
    startRinging(); render(); schedulePoll();
    return;
  }
  if(s.kind === 'ice' && s.payload && (!call || call.id !== s.callId)){   // candidate for a call we have not seen the offer of (yet)
    if(!wasHandled(s.callId)){
      earlyIce.set(s.callId, [...(earlyIce.get(s.callId) ?? []), s.payload].slice(-40));
      if(earlyIce.size > 10) earlyIce.delete(earlyIce.keys().next().value as string);
    }
    return;
  }
  if(!call || call.id !== s.callId) return;
  if(s.kind === 'ice'){
    if(!s.payload) return;
    if(call.pc && call.pc.remoteDescription) await addIce(s.payload); else call.pendingIce.push(s.payload);
  }else if(s.kind === 'answer'){
    if(call.outgoing && call.pc && s.payload){
      try{
        await call.pc.setRemoteDescription(JSON.parse(s.payload));
        for(const c of call.pendingIce.splice(0)) await addIce(c);
        setPhase('connecting');
      }catch(e){ console.error('answer failed', e); void endCall(true, false); }
    }
  }else if(s.kind === 'end'){
    const busy = s.payload === 'busy';
    cleanup(); toast(busy ? t().call.busy : t().call.ended); render();
  }
}
async function addIce(p: string){ try{ await call?.pc?.addIceCandidate(JSON.parse(p)); }catch(e){ console.warn('ice rejected', e); } }

// ---------------- the call ----------------
function newCall(id: string, jobId: string, peer: string, phase: Phase, outgoing: boolean): Call {
  return { id, jobId, peer, phase, outgoing, pc: null, local: null, muted: false, pendingOffer: null, pendingIce: [], startedAt: null, timer: null, sendQueue: Promise.resolve() };
}
function setPhase(p: Phase){
  if(!call) return;
  call.phase = p;
  if(p === 'connecting' || p === 'active') stopRinging();   // the other side has answered: no more ringing, for caller and receiver alike
  if(p === 'active' && !call.startedAt) call.startedAt = Date.now();
  if(call.timer){ clearTimeout(call.timer); call.timer = null; }
  if(p === 'connecting') call.timer = setTimeout(() => { if(call && call.phase === 'connecting'){ toast(t().call.failed); void endCall(true, false); } }, CONNECT_TIMEOUT_MS);
  render();
}

async function buildPeer(c: Call){
  c.local = await navigator.mediaDevices.getUserMedia({ audio: true });
  const pc = new RTCPeerConnection({ iceServers: [...STUN_SERVERS, ...TURN_SERVERS] });
  c.pc = pc;
  c.local.getTracks().forEach(tr => pc.addTrack(tr, c.local as MediaStream));
  pc.onicecandidate = e => { if(e.candidate && call === c) void enqueue(c, 'ice', JSON.stringify(e.candidate)).catch(() => {}); };
  pc.ontrack = e => { remoteAudio().srcObject = e.streams[0]; void remoteAudio().play().catch(() => {}); };
  pc.onconnectionstatechange = () => {
    if(call !== c) return;
    if(pc.connectionState === 'connected') setPhase('active');
    else if(pc.connectionState === 'failed' || pc.connectionState === 'closed'){ toast(t().call.failed); void endCall(true, false); }
  };
}

export async function startCall(jobId: string){
  const j = jobs.find(x => x.id === jobId), d = t().call;
  if(!j) return;
  const peer = peerOf(j);
  if(!peer) return;
  if(call){ toast(d.alreadyInCall); return; }
  if(!callsSupported()){ toast(d.unsupported); return; }
  const c = newCall(newId(), jobId, peer, 'calling', true);
  call = c; render(); schedulePoll();
  try{
    await buildPeer(c);
    const pc = c.pc as RTCPeerConnection;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await enqueue(c, 'offer', JSON.stringify(pc.localDescription));
    c.timer = setTimeout(() => { if(call === c && c.phase === 'calling'){ toast(d.noAnswer); void endCall(true, true); } }, RING_TIMEOUT_MS);
    startRinging(true);
  }catch(e){
    console.error('start call failed', e);
    const name = (e as { name?: string })?.name;
    toast(name === 'NotAllowedError' || name === 'SecurityError' ? d.micDenied : name === 'NotFoundError' ? d.noMic : d.failed);
    cleanup(); render();
  }
}

async function answerCall(){
  const c = call;
  if(!c || c.phase !== 'incoming' || !c.pendingOffer) return;
  stopRinging();
  try{
    await buildPeer(c);
    const pc = c.pc as RTCPeerConnection;
    await pc.setRemoteDescription(JSON.parse(c.pendingOffer));
    for(const x of c.pendingIce.splice(0)) await addIce(x);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await enqueue(c, 'answer', JSON.stringify(pc.localDescription));
    setPhase('connecting');
  }catch(e){
    console.error('answer failed', e);
    const name = (e as { name?: string })?.name;
    toast(name === 'NotAllowedError' || name === 'SecurityError' ? t().call.micDenied : name === 'NotFoundError' ? t().call.noMic : t().call.failed);
    void endCall(true, false);
  }
}

/** Ends the call. `tell`: notify the other side. `missed`: caller gave up before an answer (a chat note is left). */
async function endCall(tell: boolean, missed: boolean){
  const c = call;
  if(!c) return;
  const secs = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
  const wasCaller = c.outgoing;
  cleanup(); render();
  if(tell) await enqueue(c, 'end', null).catch(() => {});
  // the caller leaves a one-line trace in the chat ("missed call" / "call 2:31") so both sides can see it happened
  if(wasCaller && (secs > 0 || missed)){
    const d = t().call;
    const text = secs > 0 ? d.chatLog.replace('{t}', fmtDur(secs)) : d.chatMissed;
    await sb().rpc('send_message', { p_job_id: c.jobId, p_body: text }).then(() => {}, () => {});
  }
}
function cleanup(){
  const c = call;
  if(!c) return;
  markHandled(c.id);
  if(c.timer) clearTimeout(c.timer);
  stopRinging();
  try{ c.pc?.close(); }catch(e){ /* ignore */ }
  c.local?.getTracks().forEach(tr => tr.stop());
  const a = document.getElementById('callAudio') as HTMLAudioElement | null;
  if(a) a.srcObject = null;
  call = null;
}

// ---------------- ringing (generated tone, no audio file needed) ----------------
function beep(){
  try{
    audioCtx = audioCtx || new AudioContext();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 440; g.gain.value = 0.08;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.4);
  }catch(e){ /* sound is optional */ }
}
function startRinging(outgoingTone = false){
  stopRinging();
  beep(); ringTimer = setInterval(beep, 2000);
  if(!outgoingTone){ try{ if(navigator.vibrate) navigator.vibrate([300, 200, 300]); }catch(e){ /* optional */ } }
}
function stopRinging(){ if(ringTimer){ clearInterval(ringTimer); ringTimer = null; } }

// ---------------- UI (floating panel, independent of screen renders) ----------------
function remoteAudio(): HTMLAudioElement {
  let a = document.getElementById('callAudio') as HTMLAudioElement | null;
  if(!a){ a = document.createElement('audio'); a.id = 'callAudio'; a.autoplay = true; document.body.appendChild(a); }
  return a;
}
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
let clock: ReturnType<typeof setInterval> | null = null;

function peerName(c: Call): string {
  const j = jobs.find(x => x.id === c.jobId);
  return j && j.ownerPhone === c.peer ? t().chat.customer : t().chat.provider;
}

function render(){
  let el = document.getElementById('callPanel');
  if(clock){ clearInterval(clock); clock = null; }
  if(!call){ if(el) el.remove(); return; }
  const c = call, d = t().call;
  if(!el){ el = document.createElement('div'); el.id = 'callPanel'; el.className = 'call-panel'; el.setAttribute('role', 'dialog'); document.body.appendChild(el); }
  el.dir = t().dir;
  const status = c.phase === 'calling' ? d.calling : c.phase === 'incoming' ? d.incoming : c.phase === 'connecting' ? d.connecting : '<span id="callClock">0:00</span>';
  const btn = (id: string, label: string, cls = 'secondary') => `<button class="${cls}" id="${id}" aria-label="${label.replace(/<[^>]*>/g, '')}">${label}</button>`;
  const actions = c.phase === 'incoming'
    ? btn('callAnswer', '📞 ' + d.answer, 'call-answer') + btn('callDecline', '✖ ' + d.decline, 'call-decline')
    : (c.phase === 'active' ? btn('callMute', c.muted ? '🔇 ' + d.unmute : '🎙️ ' + d.mute) : '') + btn('callHang', d.hangUp, 'danger');
  el.classList.toggle('incoming', c.phase === 'incoming');
  el.innerHTML = `<div class="call-title">📞 ${d.title} · ${peerName(c)}</div><div class="call-status">${status}</div>
    <div class="call-actions">${actions}</div><div class="call-note">${d.ipNote}</div>`;
  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener('click', fn);
  on('callAnswer', () => { void answerCall(); });
  on('callDecline', () => { void endCall(true, false); });
  on('callHang', () => { void endCall(true, c.phase === 'calling'); });
  on('callMute', () => {
    c.muted = !c.muted;
    c.local?.getAudioTracks().forEach(tr => { tr.enabled = !c.muted; });
    render();
  });
  if(c.phase === 'active'){
    const tick = () => { const s = document.getElementById('callClock'); if(s && c.startedAt) s.textContent = fmtDur(Math.round((Date.now() - c.startedAt) / 1000)); };
    tick(); clock = setInterval(tick, 1000);
  }
}
export const inCall = () => !!call;
