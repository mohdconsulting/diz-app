import { esc, toast, $ } from './util';
import { lang, t, jobs, currentUser } from './state';
import { refreshCurrentScreen } from './shell';
import { applyToJob } from './jobs';
import type { Applicant, Job } from './types';

/*
 * When should the job be done? (diz_scheduling.sql)
 *   - the customer chooses "as soon as possible" or a day plus one or more consecutive one-hour slots
 *   - a provider can propose another day/time together with the application; the customer accepts by choosing that provider
 * All times are epoch milliseconds in the user's own time zone.
 */

export const SLOT_MS = 3600000;
export const FIRST_HOUR = 8;      // first slot 08:00–09:00
export const LAST_HOUR = 20;      // last slot 20:00–21:00
export const DAYS_AHEAD = 14;
export const MAX_SLOTS = 12;      // matches the database check (max 12 hours)
export const LEAD_MS = 30 * 60000; // a slot must start at least 30 min from now

export interface Sel { start: number | null; end: number | null }
export interface Window { start: number; end: number }

// ---------- pure helpers (also used by the tests) ----------
export function startOfDay(ms: number): number { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

export function daysFrom(now: number): number[] {
  const base = startOfDay(now);
  return Array.from({ length: DAYS_AHEAD }, (_, i) => { const d = new Date(base); d.setDate(d.getDate() + i); return d.getTime(); });
}

export function slotsOn(dayMs: number, now: number): number[] {
  const out: number[] = [];
  for(let h = FIRST_HOUR; h <= LAST_HOUR; h++){
    const d = new Date(dayMs); d.setHours(h, 0, 0, 0);
    if(d.getTime() > now + LEAD_MS) out.push(d.getTime());
  }
  return out;
}

export function hoursOf(sel: Sel): number {
  return sel.start === null || sel.end === null ? 0 : Math.round((sel.end - sel.start) / SLOT_MS);
}

/** Tapping an hour starts a selection, extends it with a neighbouring hour, shrinks it from either end, or restarts it. */
export function tapSlot(sel: Sel, slot: number): Sel {
  const slotEnd = slot + SLOT_MS;
  if(sel.start === null || sel.end === null) return { start: slot, end: slotEnd };
  const { start, end } = sel, n = hoursOf(sel);
  if(slot >= start && slot < end){
    if(n === 1) return { start: null, end: null };
    if(slot === start) return { start: slotEnd, end };
    if(slotEnd === end) return { start, end: slot };
    return { start: slot, end: slotEnd };
  }
  if(slot === end && n < MAX_SLOTS) return { start, end: slotEnd };
  if(slotEnd === start && n < MAX_SLOTS) return { start: slot, end };
  return { start: slot, end: slotEnd };
}

const hh = (ms: number) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const locale = () => lang === 'ar' ? 'ar-u-nu-latn' : lang;
export const dayText = (ms: number) => new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
export const shortDayText = (ms: number) => new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric' }).format(ms);
export const slotText = (ms: number) => hh(ms) + '–' + hh(ms + SLOT_MS);
export const windowText = (w: Window) => dayText(w.start) + ', ' + hh(w.start) + '–' + hh(w.end);

export function requestedWindow(j: Job): Window | null {
  return j.scheduleType === 'slot' && j.slotStart != null && j.slotEnd != null && j.slotEnd > j.slotStart
    ? { start: j.slotStart, end: j.slotEnd } : null;
}
export function proposedWindow(a: Applicant): Window | null {
  return a.proposedStart != null && a.proposedEnd != null && a.proposedEnd > a.proposedStart
    ? { start: a.proposedStart, end: a.proposedEnd } : null;
}
/** The time that applies once a provider is chosen: their proposal if they made one, otherwise the requested window. */
export function agreedWindow(j: Job): Window | null {
  const a = (j.applicants || []).find(x => x.phone === j.acceptedByPhone);
  return (a && proposedWindow(a)) || requestedWindow(j);
}

// ---------- picker state ----------
interface Ctx { day: number; sel: Sel }
const ctxs = new Map<string, Ctx>();

function firstDayWithSlots(): number {
  const now = Date.now();
  return daysFrom(now).find(d => slotsOn(d, now).length > 0) ?? startOfDay(now);
}
function ctx(key: string): Ctx {
  let c = ctxs.get(key);
  if(!c){ c = { day: firstDayWithSlots(), sel: { start: null, end: null } }; ctxs.set(key, c); }
  return c;
}
export function selectionOf(key: string): Sel { return ctx(key).sel; }

function pickerHTML(key: string): string {
  const d = t().sched, c = ctx(key), now = Date.now();
  const days = daysFrom(now).map(day =>
    `<div class="chip${day === c.day ? ' on' : ''}" data-day="${day}" onclick="schedPickDay('${key}',${day})">${esc(shortDayText(day))}</div>`).join('');
  const slots = slotsOn(c.day, now);
  const grid = slots.length
    ? `<div class="slot-grid">${slots.map(s =>
        `<div class="slot${s >= (c.sel.start ?? Infinity) && s < (c.sel.end ?? -Infinity) ? ' on' : ''}" data-slot="${s}" onclick="schedTapSlot('${key}',${s})">${slotText(s)}</div>`).join('')}</div>`
    : `<div class="meta">${d.noSlots}</div>`;
  const n = hoursOf(c.sel);
  const summary = n ? `<div class="sched-summary">${esc(windowText({ start: c.sel.start as number, end: c.sel.end as number }))} (${d.hours.replace('{n}', String(n))})</div>` : '';
  return `<div class="chip-row" style="margin-top:8px;">${days}</div>${grid}<div class="meta" style="margin-top:6px;">${d.hint}</div>${summary}`;
}

function rerender(key: string){ if(key === 'new') renderScheduleForm(); else refreshCurrentScreen(); }

export function schedPickDay(key: string, day: number){
  const c = ctx(key);
  c.day = day;
  if(c.sel.start !== null && startOfDay(c.sel.start) !== day) c.sel = { start: null, end: null };
  rerender(key);
}
export function schedTapSlot(key: string, slot: number){
  const c = ctx(key);
  c.sel = tapSlot(c.sel, slot);
  rerender(key);
}

// ---------- the "new request" form ----------
let asap = true;

export function renderScheduleForm(){
  const wrap = document.getElementById('scheduleWrap');
  if(!wrap) return;
  const d = t().sched;
  $('schedLabel').textContent = d.title;
  wrap.innerHTML = `<div class="chip-row">
      <div class="chip${asap ? ' on' : ''}" id="schedAsapChip" onclick="schedSetAsap(true)">${d.asap}</div>
      <div class="chip${asap ? '' : ' on'}" id="schedPickChip" onclick="schedSetAsap(false)">${d.pick}</div>
    </div>
    ${asap ? `<div class="meta" style="margin-top:6px;">${d.asapLong}</div>` : pickerHTML('new')}`;
}
export function schedSetAsap(v: boolean){ asap = v; renderScheduleForm(); }
export function resetScheduleForm(){ asap = true; ctxs.delete('new'); renderScheduleForm(); }
export function loadScheduleFromJob(j: Job){
  const w = requestedWindow(j);
  if(w){ asap = false; ctxs.set('new', { day: startOfDay(w.start), sel: { start: w.start, end: w.end } }); }
  else { asap = true; ctxs.delete('new'); }
  renderScheduleForm();
}

/** Fields to save with the request, or null if the user must choose a time first. `prev` = the request being edited. */
export function scheduleFieldsForSave(prev: Job | null): Partial<Job> | null {
  if(asap){
    // "as soon as possible" is stored as no time at all, so it keeps working before diz_scheduling.sql has been run
    return prev && prev.scheduleType === 'slot' ? { scheduleType: null, slotStart: null, slotEnd: null } : {};
  }
  const s = selectionOf('new');
  if(s.start === null || s.end === null){ toast(t().sched.chooseTime); return null; }
  return { scheduleType: 'slot', slotStart: s.start, slotEnd: s.end };
}

// ---------- job cards ----------
export function scheduleLineHTML(j: Job): string {
  const d = t().sched;
  if(j.status !== 'open' && j.status !== 'accepted' && j.status !== 'done') return '';
  const w = j.status === 'open' ? requestedWindow(j) : agreedWindow(j);
  const text = w ? `${j.status === 'open' ? d.requested : d.agreed}: ${esc(windowText(w))}` : d.asapLong;
  return `<p class="meta sched-line">🗓 ${text}</p>`;
}

/** Shown on an applicant card for the customer. */
export function applicantTimeHTML(j: Job, a: Applicant): string {
  const d = t().sched, p = proposedWindow(a);
  if(p) return `<div class="sched-proposed">${d.proposed}: ${esc(windowText(p))}</div>`;
  return requestedWindow(j) ? `<div class="meta">${d.fitsRequested}</div>` : '';
}

// ---------- provider proposal ----------
interface Prop { open: boolean; price: string }
const props = new Map<string, Prop>();

export function proposalHTML(j: Job): string {
  const d = t().sched, p = props.get(j.id);
  const mine = (j.applicants || []).find(a => a.phone === currentUser?.phone);
  const own = mine && proposedWindow(mine);
  if(!p || !p.open){
    return `${own ? `<div class="sched-proposed">${d.yourProposal}: ${esc(windowText(own))}</div>` : ''}
    <div class="action-row"><button class="secondary" onclick="schedToggleProposal('${j.id}')">${d.proposeBtn}</button></div>`;
  }
  return `<div class="sched-proposal">
    <div class="meta">${d.proposeNote}</div>
    ${own ? `<div class="sched-proposed">${d.yourProposal}: ${esc(windowText(own))}</div>` : ''}
    ${pickerHTML('p:' + j.id)}
    <label>${d.priceLabel}</label>
    <input type="number" min="1" id="proposalPrice-${j.id}" value="${esc(p.price)}" oninput="schedSetPrice('${j.id}', this.value)">
    <div class="action-row">
      <button class="secondary" onclick="submitProposal('${j.id}')">${d.proposeSend}</button>
      <button class="secondary" onclick="schedToggleProposal('${j.id}')">${d.proposeClose}</button>
    </div>
  </div>`;
}

export function schedToggleProposal(id: string){
  const j = jobs.find(x => x.id === id);
  const p = props.get(id) ?? { open: false, price: '' };
  p.open = !p.open;
  if(p.open && !p.price && j) p.price = String(j.price);
  props.set(id, p);
  refreshCurrentScreen();
}
export function schedSetPrice(id: string, v: string){
  const p = props.get(id); if(p) p.price = v;
}
export async function submitProposal(id: string){
  const j = jobs.find(x => x.id === id);
  const s = selectionOf('p:' + id);
  if(!j) return;
  if(s.start === null || s.end === null){ toast(t().sched.chooseTime); return; }
  const price = parseInt(props.get(id)?.price ?? '', 10);
  const ok = await applyToJob(id, price > 0 ? price : j.price, { start: s.start, end: s.end });
  if(ok){ props.delete(id); ctxs.delete('p:' + id); refreshCurrentScreen(); }
}
