import { mountChat } from './chat';
import { syncReviews } from './reviews';
import { mountTrackingMap, syncSharing } from './tracking';
import { $, safeGetLocal } from './util';
import { boot } from './auth';
import { type Lang, type Job } from './types';
import { lang, setLangState, role, selectedService, setJobs, dbRef, currentUser, t, db } from './state';
import { setShownSigs, setFirstSnapshotDone, markShownSeen, updateBadges, notifyNewEvents } from './notifications';
import { renderAuth, updateUserRow } from './auth';
import { renderRequestDetails, resetNewRequestForm, updateEstimate, autoReleaseExpired, renderHome, renderJobs, renderMine, renderHistory } from './jobs';
import { loadAdminUsers, renderAdmin, renderAdminUsers } from './admin';

export function screenTitleFor(name: string){
  const d = t();
  if(name==='mine') return role==='driver' ? d.mineTitleDriver : d.mineTitleCustomer;
  return (d.titles as Record<string,string>)[name];
}


export function subscribeJobs(): () => void {
  if(!dbRef) return () => {};
  return db().collection('jobs').onSnapshot(snap=>{
    setJobs(snap.docs.map(d=>({id:d.id, ...(d.data() as Omit<Job,'id'>)})));
    notifyNewEvents();
    setFirstSnapshotDone(true);
    refreshCurrentScreen();
    autoReleaseExpired();
    syncSharing();
    void syncReviews();
  }, err=>{ console.error('jobs snapshot error', err); });
}

export function applyStaticText(){
  const d = t();
  document.documentElement.lang = lang;
  document.documentElement.dir = d.dir;
  document.body.dir = d.dir;
  $('brandText').textContent = d.brand;
  $('heroTitle').textContent = d.heroTitle;
  $('heroText').textContent = d.heroText;
  $('heroBtn').textContent = d.heroBtn;
  $('statActiveLabel').textContent = d.statActiveLabel;
  $('statDoneLabel').textContent = d.statDoneLabel;
  $('recentTitle').textContent = d.recentTitle;
  $('serviceSelectTitle').textContent = d.serviceSelectTitle;
  $('openJobsTitle').textContent = d.openJobsTitle;
  $('allMineTitle').textContent = role==='driver' ? d.allMineTitleDriver : d.allMineTitleCustomer;
  $('historyTitle').textContent = d.historyTitle;
  $('customPriceChip').textContent = d.customPriceChipLabel;
  $('customPriceLabel').textContent = d.customPriceLabel;
  $('photoLabel').textContent = d.photoLabel;
  $('photoTriggerBtn').textContent = d.photoTriggerBtn;
  $('removePhotoBtn').textContent = d.removePhotoBtn;
  $('submitBtn').textContent = d.submitBtn;

  document.querySelectorAll<HTMLElement>('[data-tabkey]').forEach(el=>{
    el.textContent = (d.tabs as Record<string,string>)[el.dataset.tabkey as string];
  });
  document.querySelectorAll<HTMLElement>('#langSwitch button, #authLangSwitch button').forEach(b=>{
    b.classList.toggle('on', b.dataset.lang===lang);
  });

  const serviceChips = $('serviceChips');
  serviceChips.innerHTML = Object.entries(d.services).map(([key,val])=>
    `<div class="chip${selectedService===key?' on':''}" data-val="${key}">${val.label}</div>`
  ).join('');

  if(selectedService) renderRequestDetails();
  updateEstimate();
  renderAuth();
  if(currentUser) updateUserRow();
}


export function applyRoleUI(){
  const show=(tab: string, on: boolean)=>{ const b = document.querySelector<HTMLElement>('.tabbar button[data-tab="'+tab+'"]'); if(b) b.style.display = on ? 'flex' : 'none'; };
  const isA = role==='admin';
  show('home', role==='customer'); show('new', role==='customer'); show('jobs', role==='driver');
  show('mine', !isA); show('history', !isA); show('admin', isA); show('adminUsers', isA);
  const cur = currentScreen();
  if(isA){ if(cur!=='admin' && cur!=='adminUsers') goTo('admin'); return; }
  if(cur==='admin' || cur==='adminUsers'){ goTo(role==='driver' ? 'jobs' : 'home'); return; }
  if(role==='driver' && (cur==='home' || cur==='new')){ goTo('jobs'); return; }
  if(role==='customer' && cur==='jobs'){ goTo('home'); return; }
}

const LANG_KEY = 'diz_lang';
export function setLang(newLang: Lang){
  setLangState(newLang);
  try{ localStorage.setItem(LANG_KEY, newLang); }catch(e){ /* optional */ }
  applyStaticText();
  if(currentUser) applyRoleUI();
  refreshCurrentScreen();
}

export function currentScreen(): string {
  return document.querySelector<HTMLElement>('.screen.active')?.dataset.screen ?? 'home';
}


export function goTo(name: string){
  markShownSeen(); // events flagged on the screen we're leaving count as seen
  document.querySelectorAll<HTMLElement>('.screen').forEach(s=>s.classList.toggle('active', s.dataset.screen===name));
  document.querySelectorAll<HTMLElement>('.tabbar button').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  $('screenTitle').textContent = screenTitleFor(name);
  if(name==='new') resetNewRequestForm();
  if(name==='home') renderHome();
  if(name==='jobs') renderJobs();
  if(name==='mine') renderMine();
  if(name==='history') renderHistory();
  if(name==='admin') renderAdmin();
  if(name==='adminUsers'){ renderAdminUsers(); loadAdminUsers(); }
  updateBadges();
}

export function refreshCurrentScreen(){
  const name = currentScreen();
  setShownSigs(new Set());
  $('screenTitle').textContent = screenTitleFor(name);
  if(name==='home') renderHome();
  if(name==='jobs') renderJobs();
  if(name==='mine') renderMine();
  if(name==='history') renderHistory();
  if(name==='admin') renderAdmin();
  if(name==='adminUsers') renderAdminUsers();
  updateBadges();
  void mountTrackingMap();
  mountChat();
}


$('langSwitch').addEventListener('click', e=>{
  const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if(!b) return;
  setLang(b.dataset.lang as Lang);
});
$('authLangSwitch').addEventListener('click', e=>{
  const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if(!b) return;
  setLang(b.dataset.lang as Lang);
});

export function start(){
  const saved = safeGetLocal(LANG_KEY);
  if(saved === 'sv' || saved === 'en' || saved === 'ar') setLangState(saved);
  applyStaticText();
  void boot();
}
