import { type Job, type EventType } from './types';
import { toast, sanitizePhone } from './util';
import { role, jobs, currentUser, t, me } from './state';
import { adminCat } from './admin';

/* ---------- NOTIFICATIONS (red flags) ---------- */
export let seenSet = new Set<string>();      // event signatures the user has already seen
export let shownSigs = new Set<string>();    // flagged events rendered on the current screen
export let notifiedSigs = new Set<string>(); // events already toasted in this session
export let firstSnapshotDone = false;

export function seenKey(){ return 'diz_seen_' + (currentUser ? sanitizePhone(me().phone) : ''); }
export function loadSeen(){
  try{ seenSet = new Set(JSON.parse(localStorage.getItem(seenKey()) || '[]')); }
  catch(e){ seenSet = new Set(); }
}
export function saveSeen(){
  try{ localStorage.setItem(seenKey(), JSON.stringify(Array.from(seenSet).slice(-500))); }catch(e){}
}

// Returns the event this job currently holds for the logged-in user, or null.
export function jobEvent(j: Job): { type: EventType; sig: string } | null {
  if(!currentUser) return null;
  const isOwner = j.ownerPhone === me().phone;
  const isAssignee = j.acceptedByPhone === me().phone;
  if(j.status==='cancelled' && ((role==='customer' && isOwner) || (role==='driver' && isAssignee)) && j.completedAt && Date.now()-j.completedAt < 7*86400000){
    return {type:'cancelled', sig:j.id+':cancelled'};
  }
  if(role==='customer' && isOwner){
    if(j.status==='open'){
      const n = Array.isArray(j.applicants) ? j.applicants.length : 0;
      if(n>0) return {type:'applicant', sig:j.id+':app'+n};
    }
    if(j.status==='accepted'){
      if(j.problemReported) return j.providerResponse ? {type:'response', sig:j.id+':resp'} : null;
      if(j.markedDoneByProvider) return {type:'done', sig:j.id+':done'};
      if(j.arrived) return {type:'arrived', sig:j.id+':arrived'};
    }
  }
  if(role==='driver' && isAssignee && j.status==='accepted' && j.problemReported){
    return {type:'problem', sig:j.id+':problem'};
  }
  if(role==='driver' && isAssignee && j.status==='accepted' && !j.arrived && !j.markedDoneByProvider){
    return {type:'assigned', sig:j.id+':assigned'};
  }
  if(role==='driver' && isAssignee && j.status==='done' && j.paymentReleased && j.completedAt && Date.now()-j.completedAt < 7*86400000){
    return {type:'paid', sig:j.id+':paid'};
  }
  return null;
}
export function unseenEvents(){
  const out: { type: EventType; sig: string }[] = [];
  jobs.forEach(j=>{ const e = jobEvent(j); if(e && !seenSet.has(e.sig)) out.push(e); });
  return out;
}
export function markShownSeen(){
  if(shownSigs.size===0) return;
  shownSigs.forEach(s=>seenSet.add(s));
  shownSigs = new Set();
  saveSeen();
}
export function updateBadges(){
  const ev = currentUser ? unseenEvents() : [];
  const n = ev.length;
  const setBadge = (id: string, count: number)=>{
    const b = document.getElementById(id);
    if(b){ b.textContent = count>9 ? '9+' : String(count); b.classList.toggle('show', count>0); }
  };
  setBadge('mineBadge', ev.filter(e=>e.type!=='paid' && e.type!=='cancelled').length);
  setBadge('historyBadge', ev.filter(e=>e.type==='paid' || e.type==='cancelled').length);
  setBadge('adminBadge', (role==='admin' && currentUser) ? jobs.filter(j=>adminCat(j)==='problem').length : 0);
  document.title = (n>0 ? '('+n+') ' : '') + 'Diz';
}
export function notifyNewEvents(){
  if(!currentUser) return;
  const fresh = unseenEvents().filter(e=>!notifiedSigs.has(e.sig));
  fresh.forEach(e=>notifiedSigs.add(e.sig));
  if(firstSnapshotDone && fresh.length){
    toast('🚩 ' + t().evt[fresh[0].type]);
    try{ if(navigator.vibrate) navigator.vibrate(200); }catch(e){}
  }
}

export function setNotifiedSigs(v: typeof notifiedSigs){ notifiedSigs = v; }

export function setShownSigs(v: typeof shownSigs){ shownSigs = v; }

export function setSeenSet(v: typeof seenSet){ seenSet = v; }

export function setFirstSnapshotDone(v: typeof firstSnapshotDone){ firstSnapshotDone = v; }
