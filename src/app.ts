import { I18N, type Dict, type Service } from './i18n';
import { priceFor } from './pricing';
import { createSupabaseDbShim, SUPABASE_URL, SUPABASE_ANON_KEY, type DbShim } from './db';
import type { SbClient } from './supabase';
import type { Lang, Role, Job, JobPatch, AppUser, Applicant, EventType, ServiceKey } from './types';

/** getElementById that fails loudly instead of returning null. */
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if(!el) throw new Error('missing element #' + id);
  return el as T;
}

let lang: Lang = "sv";
let role: Role = "customer";
let selectedService: ServiceKey | null = null;
let selectedCat: string | null = null;
let selectedSize: number | null = null;
let useCustomPrice = false;
let editingJobId: string | null = null;
let photoDataUrl: string | null = null;
let jobs: Job[] = [];

let dbRef: DbShim | null = null;
let currentUser: AppUser | null = null;
let authMode: 'login' | 'register' = 'login';
let authSelectedRole: 'customer' | 'driver' | null = null;
let authSelectedProfiles = new Set<string>();
let editProfiles: Set<string> | null = null;

function t(): Dict { return I18N[lang]; }
/** The signed-in user; throws if called while signed out (callers guard on currentUser first). */
function me(): AppUser { if(!currentUser) throw new Error('not signed in'); return currentUser; }
function db(): DbShim { if(!dbRef) throw new Error('database not ready'); return dbRef; }
function sb(): SbClient { if(!sbRef) throw new Error('auth client not ready'); return sbRef; }
const ESC_MAP: Record<string, string> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function esc(s: unknown): string { return String(s==null?'':s).replace(/[&<>"']/g, c=>ESC_MAP[c]); }


function toast(msg: string){
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), msg.length>60 ? 6000 : 1800);
}

function sanitizePhone(phone: string){
  return phone.replace(/[^a-zA-Z0-9_\-.~:@+]/g, '');
}
function rememberPhone(phone: string){ try{ localStorage.setItem('diz_last_phone', phone); }catch(e){} }
function forgetPhone(){ try{ localStorage.removeItem('diz_last_phone'); }catch(e){} }
function safeGetLocal(k: string){ try{ return localStorage.getItem(k); }catch(e){ return null; } }

function screenTitleFor(name: string){
  const d = t();
  if(name==='mine') return role==='driver' ? d.mineTitleDriver : d.mineTitleCustomer;
  return (d.titles as Record<string,string>)[name];
}

/* ---------- DB ---------- */
/* ---------- NOTIFICATIONS (red flags) ---------- */
let seenSet = new Set<string>();      // event signatures the user has already seen
let shownSigs = new Set<string>();    // flagged events rendered on the current screen
let notifiedSigs = new Set<string>(); // events already toasted in this session
let firstSnapshotDone = false;

function seenKey(){ return 'diz_seen_' + (currentUser ? sanitizePhone(me().phone) : ''); }
function loadSeen(){
  try{ seenSet = new Set(JSON.parse(localStorage.getItem(seenKey()) || '[]')); }
  catch(e){ seenSet = new Set(); }
}
function saveSeen(){
  try{ localStorage.setItem(seenKey(), JSON.stringify(Array.from(seenSet).slice(-500))); }catch(e){}
}

// Returns the event this job currently holds for the logged-in user, or null.
function jobEvent(j: Job): { type: EventType; sig: string } | null {
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
function unseenEvents(){
  const out: { type: EventType; sig: string }[] = [];
  jobs.forEach(j=>{ const e = jobEvent(j); if(e && !seenSet.has(e.sig)) out.push(e); });
  return out;
}
function markShownSeen(){
  if(shownSigs.size===0) return;
  shownSigs.forEach(s=>seenSet.add(s));
  shownSigs = new Set();
  saveSeen();
}
function updateBadges(){
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
function notifyNewEvents(){
  if(!currentUser) return;
  const fresh = unseenEvents().filter(e=>!notifiedSigs.has(e.sig));
  fresh.forEach(e=>notifiedSigs.add(e.sig));
  if(firstSnapshotDone && fresh.length){
    toast('🚩 ' + t().evt[fresh[0].type]);
    try{ if(navigator.vibrate) navigator.vibrate(200); }catch(e){}
  }
}

let unsubJobs: (() => void) | null = null;
function subscribeJobs(): () => void {
  if(!dbRef) return () => {};
  return db().collection('jobs').onSnapshot(snap=>{
    jobs = snap.docs.map(d=>({id:d.id, ...(d.data() as Omit<Job,'id'>)}));
    notifyNewEvents();
    firstSnapshotDone = true;
    refreshCurrentScreen();
    autoReleaseExpired();
  }, err=>{ console.error('jobs snapshot error', err); });
}

/* ---------- AUTH ---------- */
function toggleAuthMode(){
  authMode = authMode === 'login' ? 'register' : 'login';
  authSelectedRole = null;
  authSelectedProfiles = new Set();
  renderAuth();
}

function profileOptions(){
  const d = t();
  const opts = [{key:'driver', label:d.profileDriver}, {key:'towing', label:d.profileTowing}];
  Object.entries(d.services.pro.categories).forEach(([key,label])=>{
    opts.push({key, label});
  });
  return opts;
}

function renderAuth(){
  const d = t();
  const isRegister = authMode === 'register';
  $('authTitle').textContent = isRegister ? d.authTitleRegister : d.authTitleLogin;
  $('authSubtitle').textContent = isRegister ? d.authSubtitleRegister : d.authSubtitleLogin;
  $('authNameWrap').style.display = isRegister ? 'block' : 'none';
  $('authNameLabel').textContent = d.authNameLabel;
  $('authPhoneLabel').textContent = d.authPhoneLabel;
  $('authPassLabel').textContent = d.authPassLabel;
  $('authRoleWrap').style.display = isRegister ? 'block' : 'none';
  $('authRoleLabel').textContent = d.authRoleLabel;
  $('authRoleChips').innerHTML =
    `<div class="chip${authSelectedRole==='customer'?' on':''}" data-val="customer">${d.roleCustomer}</div>
     <div class="chip${authSelectedRole==='driver'?' on':''}" data-val="driver">${d.roleDriver}</div>`;
  const showProfiles = isRegister && authSelectedRole==='driver';
  $('authProfileWrap').style.display = showProfiles ? 'block' : 'none';
  if(showProfiles){
    $('authProfileLabel').textContent = d.authProfileLabel;
    $('authProfileChips').innerHTML = profileOptions().map(o=>
      `<div class="chip${authSelectedProfiles.has(o.key)?' on':''}" data-val="${o.key}">${o.label}</div>`
    ).join('');
  }
  $('authSubmitBtn').textContent = isRegister ? d.authSubmitRegister : d.authSubmitLogin;
  $('authSwitchText').textContent = isRegister ? d.authSwitchTextRegister : d.authSwitchTextLogin;
  $('authSwitchBtn').textContent = isRegister ? d.authSwitchBtnRegister : d.authSwitchBtnLogin;
}

$('authRoleChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  authSelectedRole = (chip.dataset.val as 'customer' | 'driver');
  if(authSelectedRole !== 'driver') authSelectedProfiles = new Set();
  renderAuth();
});
$('authProfileChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  const key = chip.dataset.val as string;
  if(authSelectedProfiles.has(key)) authSelectedProfiles.delete(key);
  else authSelectedProfiles.add(key);
  renderAuth();
});

let sbRef: SbClient | null = null;
// Supabase Auth needs an email-shaped id and rejects domains without mail servers, so each phone number is mapped to
// diz.<digits>@gmail.com. No mail is ever sent (Confirm email must be OFF). To use your own domain, change the constants.
const AUTH_EMAIL_PREFIX = 'diz.';
const AUTH_EMAIL_DOMAIN = 'gmail.com';
function authEmail(phone: string): string {
  const local = phone.replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
  return local ? AUTH_EMAIL_PREFIX + local + '@' + AUTH_EMAIL_DOMAIN : '';
}
async function loadProfile(uid: string): Promise<boolean> {
  if(!dbRef) return false;
  const snap = await db().user(uid).get();
  const data = snap.data();
  if(!snap.exists || !data) return false;
  const user = {id:uid, ...data} as unknown as AppUser;
  currentUser = user;
  role = user.role;
  return true;
}

async function submitAuth(){
  const d = t();
  if(!dbRef || !sbRef){ toast(d.toastDbUnavailable); return; }
  const phone = $<HTMLInputElement>('authPhoneInput').value.trim();
  const pass = $<HTMLInputElement>('authPassInput').value;
  const email = authEmail(phone);
  if(authMode === 'register'){
    const name = $<HTMLInputElement>('authNameInput').value.trim();
    if(!name || !phone || !pass || !email){ toast(d.toastAuthMissingFields); return; }
    if(!authSelectedRole){ toast(d.toastAuthMissingRole); return; }
    if(authSelectedRole==='driver' && authSelectedProfiles.size===0){ toast(d.toastAuthMissingProfiles); return; }
    if(pass.length < 6){ toast(d.toastPasswordShort); return; }
    const profiles = authSelectedRole==='driver' ? Array.from(authSelectedProfiles) : [];
    try{
      const { data, error } = await sb().auth.signUp({
        email, password: pass,
        options: { data: { name, phone, role: authSelectedRole, profiles } }
      });
      if(error){
        console.error('signUp failed', error);
        toast(/registered|exists/i.test(error.message) ? d.toastAuthPhoneTaken : (/password/i.test(error.message) ? d.toastPasswordShort : d.toastSaveFailed + ' [' + error.message + ']'));
        return;
      }
      if(!data.session){ toast(d.toastAuthNeedsConfirm); return; }
      if(!data.user || !(await loadProfile(data.user.id))){ toast(d.toastSaveFailed + ' [profile missing]'); return; }
    }catch(e){ console.error(e); toast(d.toastSaveFailed + ' [' + (e instanceof Error ? e.message : String(e)) + ']'); return; }
    toast(d.toastRegisterSuccess);
    enterApp();
  } else {
    if(!phone || !pass || !email){ toast(d.toastAuthMissingFields); return; }
    try{
      const { data, error } = await sb().auth.signInWithPassword({ email, password: pass });
      if(error){ toast(d.toastAuthLoginFailed); return; }
      if(!(await loadProfile(data.user!.id))){ await sb().auth.signOut(); toast(d.toastAuthLoginFailed); return; }
      toast(d.toastLoginSuccess);
      enterApp();
    }catch(e){ toast(d.toastSaveFailed); }
  }
}

function enterApp(){
  $('authOverlay').style.display = 'none';
  $<HTMLInputElement>('authPhoneInput').value = '';
  $<HTMLInputElement>('authPassInput').value = '';
  $<HTMLInputElement>('authNameInput').value = '';
  authSelectedRole = null;
  loadSeen();
  shownSigs = new Set();
  notifiedSigs = new Set(unseenEvents().map(e=>e.sig));
  updateUserRow();
  applyRoleUI();
  if(!unsubJobs) unsubJobs = subscribeJobs();
  if(role==='admin') loadAdminData();
  goTo(role==='admin' ? 'admin' : (role==='driver' ? 'jobs' : 'home'));
}

function updateUserRow(){
  if(!currentUser) return;
  const d = t();
  $('userGreeting').textContent =
    `${d.greetingPrefix}, ${me().name} · ${roleLabel()}`;
  $('logoutBtn').textContent = d.logoutBtn;
}

async function logout(){
  markShownSeen();
  if(unsubJobs){ unsubJobs(); unsubJobs = null; }
  jobs = []; firstSnapshotDone = false;
  adminUsersList = []; adminNotes = {};
  try{ if(sbRef) await sb().auth.signOut(); }catch(e){}
  currentUser = null;
  seenSet = new Set(); shownSigs = new Set(); notifiedSigs = new Set();
  updateBadges();
  editProfiles = null;
  authMode = 'login';
  renderAuth();
  $('authOverlay').style.display = 'flex';
}

function renderAccountEdit(){
  $('accountEditTitle').textContent = t().accountEditTitle;
  $('accountNameLabel').textContent = t().authNameLabel;
  $('accountPhoneLabel').textContent = t().authPhoneLabel;
  $('accountSaveBtn').textContent = t().accountSaveBtn;
  const nameInput = $<HTMLInputElement>('accountNameInput');
  const phoneInput = $<HTMLInputElement>('accountPhoneInput');
  if(document.activeElement !== nameInput) nameInput.value = me().name;
  phoneInput.value = me().phone;
  phoneInput.disabled = true; // phone number is the login id and can't be changed
}

async function saveAccountDetails(){
  if(!dbRef || !currentUser) return;
  const d = t();
  const newName = $<HTMLInputElement>('accountNameInput').value.trim();
  if(!newName){ toast(d.toastAuthMissingFields); return; }
  try{
    await db().user(me().id).update({name:newName});
    me().name = newName;
    toast(d.toastAccountSaved);
    updateUserRow();
  }catch(e){ toast(d.toastSaveFailed); }
}

function renderProfileEdit(){
  const wrap = $('profileEditWrap');
  if(role !== 'driver' || !currentUser){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const ep: Set<string> = editProfiles ?? (editProfiles = new Set(me().profiles || []));
  $('profileEditTitle').textContent = t().profileEditTitle;
  $('profileEditChips').innerHTML = profileOptions().map(o=>
    `<div class="chip${ep.has(o.key)?' on':''}" data-val="${o.key}">${o.label}</div>`
  ).join('');
  $('profileSaveBtn').textContent = t().profileSaveBtn;
}

$('profileEditChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  const key = chip.dataset.val as string;
  if(!editProfiles) return;
  if(editProfiles.has(key)) editProfiles.delete(key); else editProfiles.add(key);
  chip.classList.toggle('on');
});

async function saveProfile(){
  if(!dbRef || !currentUser) return;
  if(!editProfiles || editProfiles.size===0){ toast(t().toastAuthMissingProfiles); return; }
  const profiles = Array.from(editProfiles);
  try{
    await db().user(me().id).update({profiles});
    me().profiles = profiles;
    toast(t().toastProfileSaved);
    refreshCurrentScreen();
  }catch(e){ toast(t().toastSaveFailed); }
}

/* ---------- BOOT ---------- */
async function boot(){
  $('authNote').textContent = t().authConnecting;
  $<HTMLInputElement>('authSubmitBtn').disabled = true;

  try{
    if(!window.supabase) throw new Error('supabase-js not loaded');
    sbRef = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    dbRef = createSupabaseDbShim(sbRef);
  }catch(e){ dbRef = null; sbRef = null; }

  $('authNote').textContent = '';
  $<HTMLInputElement>('authSubmitBtn').disabled = false;

  if(!dbRef){
    toast(t().toastDbUnavailable);
    $('authOverlay').style.display = 'flex';
    return;
  }

  // Restore an existing Supabase session (stored by supabase-js in the browser)
  try{
    if(!sbRef) throw new Error('no client');
    const { data } = await sb().auth.getSession();
    if(data && data.session && await loadProfile(data.session.user.id)){
      enterApp();
      return;
    }
  }catch(e){}
  $('authOverlay').style.display = 'flex';
}
/* ---------- END AUTH/DB ---------- */

function applyStaticText(){
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

function renderRequestDetails(){
  const d = t();
  if(!selectedService) return;
  const svc = d.services[selectedService];
  $('requestDetails').style.display = 'block';
  $('categoryLabel').textContent = svc.categoryLabel;
  $('sizeLabel').textContent = svc.sizeLabel;
  $<HTMLInputElement>('descInput').placeholder = svc.descPlaceholder;
  $('addrLabel').textContent = svc.addrLabel;
  $<HTMLInputElement>('addrInput').placeholder = svc.addrPlaceholder;
  $('toAddrWrap').style.display = svc.needsToAddr ? 'block' : 'none';
  if(svc.needsToAddr){
    $('toAddrLabel').textContent = svc.toAddrLabel ?? '';
    $<HTMLInputElement>('toAddrInput').placeholder = svc.toAddrPlaceholder ?? '';
  }
  $('catChips').innerHTML = Object.entries(svc.categories).map(([key,label])=>
    `<div class="chip${selectedCat===key?' on':''}" data-val="${key}">${label}</div>`
  ).join('');
  $('sizeChips').innerHTML = Object.entries(svc.sizes).map(([key,label])=>
    `<div class="chip${selectedSize===parseInt(key)?' on':''}" data-val="${key}">${label}</div>`
  ).join('');
}

function applyRoleUI(){
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

function setLang(newLang: Lang){
  lang = newLang;
  applyStaticText();
  if(currentUser) applyRoleUI();
  refreshCurrentScreen();
}

function currentScreen(): string {
  return document.querySelector<HTMLElement>('.screen.active')?.dataset.screen ?? 'home';
}

function handlePhotoSelect(e: Event){
  const file = (e.target as HTMLInputElement).files?.[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(ev){
    const img = new Image();
    img.onload = function(){
      const maxW = 800;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale) || 1;
      const h = Math.round(img.height * scale) || 1;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if(!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      photoDataUrl = canvas.toDataURL('image/jpeg', 0.6);
      $<HTMLImageElement>('photoPreviewImg').src = photoDataUrl;
      $('photoPreviewWrap').style.display = 'block';
    };
    img.src = String(ev.target?.result ?? '');
  };
  reader.readAsDataURL(file);
}

function removePhoto(){
  photoDataUrl = null;
  $<HTMLInputElement>('photoInput').value = '';
  $('photoPreviewWrap').style.display = 'none';
}

function resetNewRequestForm(){
  editingJobId = null;
  selectedService = null; selectedCat = null; selectedSize = null; useCustomPrice = false;
  photoDataUrl = null;
  $<HTMLInputElement>('photoInput').value = '';
  $('photoPreviewWrap').style.display = 'none';
  document.querySelectorAll('#serviceChips .chip, #catChips .chip, #sizeChips .chip').forEach(c=>c.classList.remove('on'));
  $('requestDetails').style.display = 'none';
  $<HTMLInputElement>('descInput').value = '';
  $<HTMLInputElement>('addrInput').value = '';
  if($('toAddrInput')) $<HTMLInputElement>('toAddrInput').value = '';
  $('customPriceChip').classList.remove('on');
  $('customPriceWrap').style.display = 'none';
  $<HTMLInputElement>('customPriceInput').value = '';
  $('submitBtn').textContent = t().submitBtn;
  updateEstimate();
}

function goTo(name: string){
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

function refreshCurrentScreen(){
  const name = currentScreen();
  shownSigs = new Set();
  $('screenTitle').textContent = screenTitleFor(name);
  if(name==='home') renderHome();
  if(name==='jobs') renderJobs();
  if(name==='mine') renderMine();
  if(name==='history') renderHistory();
  if(name==='admin') renderAdmin();
  if(name==='adminUsers') renderAdminUsers();
  updateBadges();
}

$('serviceChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  document.querySelectorAll<HTMLElement>('#serviceChips .chip').forEach(c=>c.classList.remove('on'));
  chip.classList.add('on');
  selectedService = chip.dataset.val as ServiceKey;
  selectedCat = null; selectedSize = null; useCustomPrice = false;
  $('customPriceChip').classList.remove('on');
  $('customPriceWrap').style.display = 'none';
  renderRequestDetails();
  updateEstimate();
});
$('catChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  document.querySelectorAll('#catChips .chip').forEach(c=>c.classList.remove('on'));
  chip.classList.add('on'); selectedCat = chip.dataset.val ?? null; updateEstimate();
});
$('sizeChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  document.querySelectorAll('#sizeChips .chip').forEach(c=>c.classList.remove('on'));
  chip.classList.add('on'); selectedSize = parseInt(chip.dataset.val as string); updateEstimate();
});
$('langSwitch').addEventListener('click', e=>{
  const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if(!b) return;
  setLang(b.dataset.lang as Lang);
});
$('authLangSwitch').addEventListener('click', e=>{
  const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if(!b) return;
  setLang(b.dataset.lang as Lang);
});
$('customPriceChip').addEventListener('click', ()=>{
  useCustomPrice = !useCustomPrice;
  $('customPriceChip').classList.toggle('on', useCustomPrice);
  $('customPriceWrap').style.display = useCustomPrice ? 'block' : 'none';
  if(useCustomPrice){
    const input = $<HTMLInputElement>('customPriceInput');
    if(!input.value && selectedSize && selectedService) input.value = String(priceFor(selectedService, selectedSize, selectedCat));
  }
  updateEstimate();
});
$('customPriceInput').addEventListener('input', updateEstimate);

function updateEstimate(){
  const el = $('priceEstimate');
  const sub = $('estimateSub');
  if(!sub) return;
  sub.textContent = useCustomPrice ? t().estimateSubCustom : t().estimateSub;
  if(useCustomPrice){
    const val = parseInt($<HTMLInputElement>('customPriceInput').value, 10);
    el.textContent = (val>0) ? (val + " " + t().priceUnit) : "–";
    return;
  }
  if(selectedService && selectedSize){
    el.textContent = priceFor(selectedService, selectedSize, selectedCat) + " " + t().priceUnit;
  } else {
    el.textContent = "–";
  }
}

async function providerArrive(id: string){
  if(!dbRef) return;
  try{
    await db().job(id).update({arrived:true, arrivedAt:Date.now()});
    toast(t().toastProviderArrived);
  }catch(e){ toast(t().toastSaveFailed); }
}

async function providerMarkDone(id: string){
  if(!dbRef) return;
  try{
    await db().job(id).update({markedDoneByProvider:true, markedDoneAt:Date.now()});
    toast(t().toastProviderMarkedDone);
  }catch(e){ toast(t().toastSaveFailed); }
}

async function completeJob(id: string){
  if(!dbRef) return;
  const j = jobs.find(x=>x.id===id);
  if(!j || !(j.arrived || j.markedDoneByProvider)) return;
  try{
    await db().job(id).update({status:'done', paymentReleased:true, completedAt:Date.now()});
    toast(t().toastJobCompleted);
  }catch(e){ toast(t().toastSaveFailed); }
}

const REPORT_WINDOW_MS = 5*86400000; // customer may report a problem for 5 days after the provider marks the job done
let reportingId: string | null = null, reportDraft = '';
function startReport(id: string){ reportingId = id; reportDraft = ''; refreshCurrentScreen(); }
function cancelReport(){ reportingId = null; reportDraft = ''; refreshCurrentScreen(); }
async function submitReport(id: string){
  const text = reportDraft.trim();
  if(!text){ toast(t().toastReportEmpty); return; }
  if(!dbRef) return;
  try{
    await db().job(id).update({problemReported:true, problemText:text, problemReportedAt:Date.now()});
    reportingId = null; reportDraft = '';
    toast(t().toastProblemReported);
  }catch(e){ toast(t().toastSaveFailed); }
}
let respondDrafts: Record<string, string> = {};
async function submitResponse(id: string){
  const text = (respondDrafts[id]||'').trim();
  if(!text){ toast(t().toastResponseEmpty); return; }
  if(!dbRef) return;
  try{
    await db().job(id).update({providerResponse:text, providerResponseAt:Date.now()});
    delete respondDrafts[id];
    toast(t().toastResponseSent);
  }catch(e){ toast(t().toastSaveFailed); }
}
function fmtRemaining(ms: number): string {
  if(ms<0) ms = 0;
  const d = Math.floor(ms/86400000), h = Math.floor((ms%86400000)/3600000);
  return t().remainingFmt.replace('{d}', String(d)).replace('{h}', String(h));
}
// Client-side fallback; the database (pg_cron) does the same on the server.
const autoReleasing = new Set();
async function autoReleaseExpired(){
  if(!dbRef || !currentUser) return;
  const now = Date.now();
  for(const j of jobs){
    if(j.status!=='accepted' || !j.markedDoneByProvider || j.problemReported || !j.markedDoneAt) continue;
    if(now - j.markedDoneAt < REPORT_WINDOW_MS) continue;
    if(j.ownerPhone!==me().phone && j.acceptedByPhone!==me().phone) continue;
    if(autoReleasing.has(j.id)) continue;
    autoReleasing.add(j.id);
    try{ await db().job(j.id).update({status:'done', paymentReleased:true, autoReleased:true, completedAt:now}); }
    catch(e){ autoReleasing.delete(j.id); }
  }
}
setInterval(autoReleaseExpired, 5*60*1000);

let pendingDeleteId: string | null = null;

function askDelete(id: string){
  pendingDeleteId = id;
  refreshCurrentScreen();
}
function cancelDelete(){
  pendingDeleteId = null;
  refreshCurrentScreen();
}
async function confirmDeleteRequest(id: string){
  if(!dbRef) return;
  try{
    await db().job(id).delete();
    if(editingJobId === id) resetNewRequestForm();
    pendingDeleteId = null;
    toast(t().toastRequestDeleted);
  }catch(e){ toast(t().toastSaveFailed); }
}

function editJob(id: string){
  const j = jobs.find(x=>x.id===id);
  if(!j || j.status !== 'open') return;
  goTo('new');
  editingJobId = id;
  selectedService = j.service;
  selectedCat = j.cat;
  selectedSize = j.size;
  const computedPrice = priceFor(j.service, j.size, j.cat);
  useCustomPrice = (j.price !== computedPrice);

  document.querySelectorAll<HTMLElement>('#serviceChips .chip').forEach(c=>c.classList.toggle('on', c.dataset.val===selectedService));
  renderRequestDetails();
  $<HTMLInputElement>('descInput').value = j.desc ?? '';
  photoDataUrl = j.photo || null;
  if(photoDataUrl){
    $<HTMLImageElement>('photoPreviewImg').src = photoDataUrl;
    $('photoPreviewWrap').style.display = 'block';
  } else {
    $('photoPreviewWrap').style.display = 'none';
  }
  $<HTMLInputElement>('addrInput').value = j.addr ?? '';
  if($('toAddrInput')) $<HTMLInputElement>('toAddrInput').value = j.toAddr || '';
  $('customPriceChip').classList.toggle('on', useCustomPrice);
  $('customPriceWrap').style.display = useCustomPrice ? 'block' : 'none';
  if(useCustomPrice) $<HTMLInputElement>('customPriceInput').value = String(j.price);
  updateEstimate();
  $('submitBtn').textContent = t().saveChangesBtn;
}

async function submitRequest(){
  const d = t();
  if(!dbRef){ toast(d.toastDbUnavailable); return; }
  const desc = $<HTMLInputElement>('descInput').value.trim();
  const addr = $<HTMLInputElement>('addrInput').value.trim();
  if(!selectedService){ toast(d.toastMissingFields); return; }
  const service: ServiceKey = selectedService;
  const svc = d.services[service];
  const toAddr = svc.needsToAddr ? $<HTMLInputElement>('toAddrInput').value.trim() : null;
  if(!selectedCat || !selectedSize){ toast(d.toastMissingCatSize); return; }
  if(!desc || !addr || (svc.needsToAddr && !toAddr)){ toast(d.toastMissingFields); return; }
  let price: number;
  if(useCustomPrice){
    const val = parseInt($<HTMLInputElement>('customPriceInput').value, 10);
    if(!val || val<=0){ toast(d.toastInvalidOffer); return; }
    price = val;
  } else {
    price = priceFor(service, selectedSize, selectedCat);
  }
  const wasEditing = !!editingJobId;
  try{
    if(wasEditing && editingJobId){
      await db().job(editingJobId).update({service, cat:selectedCat, desc, addr, toAddr, size:selectedSize, price, photo: photoDataUrl || null});
    } else {
      await db().collection('jobs').add({
        service, cat:selectedCat, desc, addr, toAddr, size:selectedSize, price,
        photo: photoDataUrl || null,
        status:"open",
        ownerPhone: me().phone, acceptedByPhone:null, createdAt: Date.now()
      });
    }
  }catch(e){ toast(d.toastSaveFailed); return; }
  resetNewRequestForm();
  toast(wasEditing ? d.toastRequestUpdated : d.toastSubmitted);
  goTo('home');
}

function svcDict(service: string): Service | undefined { return (t().services as Record<string, Service>)[service]; }
function catLabel(service: string, key: string | null): string { return (key && svcDict(service)?.categories?.[key]) || key || ''; }
function serviceLabel(service: string): string { return svcDict(service)?.label || service; }
function effectiveStatusKey(j: Job): 'open' | 'accepted' | 'arrived' | 'problem' | 'done' | 'cancelled' {
  if(j.status==='accepted' && j.problemReported) return 'problem';
  if(j.status==='accepted' && (j.arrived || j.markedDoneByProvider)) return 'arrived';
  return j.status;
}
function statusLabel(j: Job): string { return t().status[effectiveStatusKey(j)]; }
function statusClass(j: Job): string { return {open:"waiting", accepted:"accepted", arrived:"accepted", problem:"problem", done:"done", cancelled:"done"}[effectiveStatusKey(j)]; }
function isFinal(j: Job): boolean { return j.status==='done' || j.status==='cancelled'; }
function roleLabel(){ const d=t(); return role==='admin' ? ad().roleAdmin : (role==='driver' ? d.roleDriver : d.roleCustomer); }

function submitOffer(id: string){
  const j = jobs.find(x=>x.id===id);
  if(!j) return;
  applyToJob(id, j.price);
}

function submitCustomOffer(id: string){
  const input = $<HTMLInputElement>('offerInput-'+id);
  const val = parseInt(input.value, 10);
  if(!val || val<=0){ toast(t().toastInvalidOffer); return; }
  applyToJob(id, val);
}

async function applyToJob(id: string, price: number){
  if(!dbRef || !currentUser) return;
  const j = jobs.find(x=>x.id===id);
  if(!j) return;
  const applicants = Array.isArray(j.applicants) ? j.applicants.slice() : [];
  const idx = applicants.findIndex(a=>a.phone===me().phone);
  const entry = {phone: me().phone, name: me().name, price, appliedAt: Date.now()};
  if(idx>=0) applicants[idx] = entry; else applicants.push(entry);
  try{
    await db().job(id).update({applicants});
    toast(t().toastApplied);
  }catch(e){ toast(t().toastSaveFailed); return; }

  if(!j.ownerPhone){
    setTimeout(async ()=>{
      const jj = jobs.find(x=>x.id===id);
      if(jj && jj.status==='open'){
        try{
          await db().job(id).update({status:'accepted', acceptedByPhone: me().phone, price});
          toast(t().toastAutoAssignedSim);
        }catch(e){}
      }
    }, 1700);
  }
}

async function assignJob(id: string, phone: string){
  if(!dbRef) return;
  const j = jobs.find(x=>x.id===id);
  if(!j) return;
  const applicants = Array.isArray(j.applicants) ? j.applicants : [];
  const chosen = applicants.find(a=>a.phone===phone);
  if(!chosen) return;
  try{
    await db().job(id).update({status:'accepted', acceptedByPhone: phone, price: chosen.price});
    toast(t().toastAssigned);
  }catch(e){ toast(t().toastSaveFailed); }
}

function jobCardHTML(j: Job, courierView: boolean): string {
  const d = t();
  const isMine = currentUser && j.ownerPhone === me().phone;
  const isMyAcceptedJob = currentUser && j.acceptedByPhone === me().phone;
  let body;
  const applicants = Array.isArray(j.applicants) ? j.applicants : [];
  if(courierView){
    if(j.status==='open'){
      const mine = applicants.find(a=>a.phone===currentUser?.phone);
      const note = mine
        ? `<div style="margin-top:6px;font-size:12px;color:var(--muted);">${d.yourApplicationNote.replace('{price}', mine.price + ' ' + d.priceUnit)}</div>`
        : '';
      body = `${note}
      <div class="action-row">
        <button class="secondary" onclick="submitOffer('${j.id}')">${d.takeJobBtn}</button>
      </div>
      <div class="offer-row">
        <input type="number" min="1" id="offerInput-${j.id}" value="${mine ? mine.price : j.price}">
        <button class="secondary" onclick="submitCustomOffer('${j.id}')">${d.proposePriceBtn}</button>
      </div>`;
    } else {
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>`;
    }
  } else {
    if(j.status==='open' && isMine && role==='customer' && pendingDeleteId!==j.id){
      const applicantsHtml = applicants.length
        ? applicants.slice().sort((a,b)=>a.price-b.price).map(a=>`
          <div class="card" style="margin-bottom:8px;padding:10px 12px;">
            <div class="top-row">
              <div><h3 style="font-size:14px;">${esc(a.name || a.phone)}</h3></div>
              <div class="price" style="font-size:14px;">${a.price} ${d.priceUnit}</div>
            </div>
            <div class="action-row">
              <button class="secondary" onclick="assignJob('${j.id}','${a.phone}')">${d.assignBtn}</button>
            </div>
          </div>`).join('')
        : `<div class="empty" style="padding:14px;">${d.noApplicantsYet}</div>`;
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
      <div style="margin-top:10px;">
        <p class="section-title" style="margin-bottom:8px;">${d.applicantsTitle}${applicants.length ? ' (' + applicants.length + ')' : ''}</p>
        ${applicantsHtml}
      </div>
      <div class="action-row">
        <button class="secondary" onclick="editJob('${j.id}')">${d.editBtn}</button>
        <button class="secondary" onclick="askDelete('${j.id}')">${d.deleteBtn}</button>
      </div>`;
    } else if(j.status==='accepted' && isMine && role==='customer'){
      let note = '';
      let btnLabel = d.completeBtn;
      const canComplete = !!(j.arrived || j.markedDoneByProvider);
      const noteStyle = 'margin-top:8px;font-size:13px;';
      const subStyle = 'margin-top:6px;font-size:12.5px;color:var(--muted);';
      if(j.problemReported){
        note = `<div style="${noteStyle}">${d.problemReportedNoteCustomer}</div>
          <div style="${subStyle}">“${esc(j.problemText||'')}”</div>
          ${j.providerResponse ? `<div style="margin-top:8px;font-size:13px;"><b>${d.providerResponseLabel}:</b> “${esc(j.providerResponse)}”</div>` : ''}`;
        btnLabel = d.confirmReleaseBtn;
      } else if(j.markedDoneByProvider){
        const left = fmtRemaining((j.markedDoneAt||Date.now()) + REPORT_WINDOW_MS - Date.now());
        note = `<div style="${noteStyle}">${d.providerMarkedDoneNote}</div>
          <div style="${subStyle}">${d.autoReleaseNote.replace('{time}', left)}</div>`;
        btnLabel = d.confirmReleaseBtn;
      } else if(j.arrived){
        note = `<div style="${noteStyle}">${d.arrivedNoteCustomer}</div>`;
      } else {
        note = `<div style="${noteStyle}color:var(--muted);">${d.waitingProviderArriveNote}</div>`;
      }
      let actions = '';
      if(reportingId===j.id && !j.problemReported){
        actions = `<div style="margin-top:10px;">
          <label style="margin-top:0;">${d.reportProblemPrompt}</label>
          <textarea id="reportInput-${j.id}" oninput="setReportDraft(this.value)" placeholder="${esc(d.reportProblemPlaceholder)}">${esc(reportDraft)}</textarea>
        </div>
        <div class="action-row">
          <button class="secondary" onclick="submitReport('${j.id}')">${d.sendReportBtn}</button>
          <button class="secondary" onclick="cancelReport()">${d.cancelBtn}</button>
        </div>`;
      } else if(canComplete){
        actions = `<div class="action-row">
          <button class="secondary" onclick="completeJob('${j.id}')">${btnLabel}</button>
          ${j.problemReported ? '' : `<button class="secondary" onclick="startReport('${j.id}')">${d.reportProblemBtn}</button>`}
        </div>`;
      }
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
      ${note}
      ${actions}`;
    } else if(j.status==='accepted' && role==='driver' && isMyAcceptedJob){
      let problemNote = '';
      if(j.problemReported){
        problemNote = `<div style="margin-top:6px;font-size:12.5px;color:var(--danger);">${d.problemReportedNoteProvider.replace('{text}', ()=>esc(j.problemText||''))}</div>`;
        if(j.providerResponse){
          problemNote += `<div style="margin-top:8px;font-size:13px;"><b>${d.yourResponseLabel}:</b> “${esc(j.providerResponse)}”</div>`;
        } else {
          problemNote += `<div style="margin-top:10px;">
            <label style="margin-top:0;">${d.respondPrompt}</label>
            <textarea id="respondInput-${j.id}" oninput="setRespondDraft('${j.id}', this.value)" placeholder="${esc(d.respondPlaceholder)}">${esc(respondDrafts[j.id]||'')}</textarea>
          </div>
          <div class="action-row">
            <button class="secondary" onclick="submitResponse('${j.id}')">${d.sendResponseBtn}</button>
          </div>`;
        }
      }
      if(j.markedDoneByProvider){
        body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
        ${problemNote}
        <div style="margin-top:6px;font-size:12px;color:var(--muted);">${d.waitingCustomerConfirmNote}</div>`;
      } else if(j.arrived){
        body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
        ${problemNote}
        <div style="margin-top:6px;font-size:12px;color:var(--muted);">${d.arrivedNoteProvider}</div>
        <div class="action-row">
          <button class="secondary" onclick="providerMarkDone('${j.id}')">${d.providerCompleteBtn}</button>
        </div>`;
      } else {
        body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
        <div class="action-row">
          <button class="secondary" onclick="providerArrive('${j.id}')">${d.providerArriveBtn}</button>
        </div>`;
      }
    } else if(j.status==='cancelled'){
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
      <div style="margin-top:6px;font-size:12px;color:var(--muted);">${ad().cancelledNote}</div>`;
    } else if(j.status==='done'){
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
      <div style="margin-top:6px;font-size:12px;color:var(--muted);">${j.resolution==='released' ? ad().releasedNote : (j.autoReleased ? d.autoReleasedNote : d.paymentReleasedNote)}</div>`;
    } else if(j.status==='open' && isMine && role==='customer' && pendingDeleteId===j.id){
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
      <div style="margin-top:8px;font-size:13px;">${d.confirmDeleteInline}</div>
      <div class="action-row">
        <button class="secondary" onclick="confirmDeleteRequest('${j.id}')">${d.confirmDeleteBtn}</button>
        <button class="secondary" onclick="cancelDelete()">${d.cancelBtn}</button>
      </div>`;
    } else {
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>`;
    }
  }
  const route = j.toAddr ? `${j.addr} → ${j.toAddr}` : j.addr;
  const ev = jobEvent(j);
  let flagHtml = '';
  if(ev && !seenSet.has(ev.sig)){
    shownSigs.add(ev.sig);
    flagHtml = `<div class="flag"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3v18h2v-7h11l-2-4 2-4H7V3z"/></svg>${d.evt[ev.type]}</div>`;
  }
  return `<div class="card route">
    ${flagHtml}
    <div class="top-row">
      <div>
        <div class="service-badge">${serviceLabel(j.service)}</div>
        <h3>${catLabel(j.service, j.cat)}</h3>
        <p class="meta">${esc(j.desc)}</p>
      </div>
      <div class="price">${j.price} ${d.priceUnit}</div>
    </div>
    ${j.photo ? `<img src="${j.photo}" alt="" style="width:100%;max-height:160px;object-fit:cover;margin-top:10px;border:1px solid var(--line);">` : ''}
    <p class="meta" style="margin-top:8px;">${esc(route)}</p>
    ${body}
  </div>`;
}

function renderHome(){
  if(!currentUser) return;
  const all = jobs.filter(j=>j.ownerPhone===me().phone);
  $('statActive').textContent = String(all.filter(r=>!isFinal(r)).length);
  $('statDone').textContent = String(all.filter(r=>r.status==="done").length);
  const mine = all.filter(j=>!isFinal(j));
  const list = $('homeList');
  if(mine.length===0){
    list.innerHTML = `<div class="empty">${t().emptyHome}</div>`;
    return;
  }
  list.innerHTML = mine.slice(0,3).map(j=>jobCardHTML(j,false)).join('');
}

function providerCanTake(job: Job): boolean {
  if(!currentUser || !me().profiles || me().profiles.length===0) return true;
  const profiles = me().profiles;
  if(profiles.includes('driver') && (job.service==='junk' || job.service==='moving' || job.service==='goods' || job.service==='deliver')) return true;
  if(job.service==='pro' && profiles.includes(job.cat ?? '')) return true;
  if(job.service==='towing' && profiles.includes('towing')) return true;
  return false;
}

function renderJobs(){
  const open = jobs.filter(j=>j.status==="open" && providerCanTake(j));
  const taken = jobs.filter(j=>j.status==="accepted" && j.acceptedByPhone===currentUser?.phone);
  const list = $('jobsList');
  let html = "";
  if(open.length===0){
    html += `<div class="empty">${t().emptyJobs}</div>`;
  } else {
    html += open.map(j=>jobCardHTML(j,true)).join('');
  }
  if(taken.length){
    html += `<p class="section-title" style="margin-top:18px;">${t().takenTitle}</p>` + taken.map(j=>jobCardHTML(j,false)).join('');
  }
  list.innerHTML = html;
}

function renderMine(){
  if(!currentUser) return;
  renderAccountEdit();
  renderProfileEdit();
  const list = $('mineList');
  if(role==='driver'){
    const mineJobs = jobs.filter(j=>j.acceptedByPhone===me().phone && !isFinal(j));
    if(mineJobs.length===0){
      list.innerHTML = `<div class="empty">${t().emptyMineDriver}</div>`;
      return;
    }
    list.innerHTML = mineJobs.map(j=>jobCardHTML(j,false)).join('');
    return;
  }
  const mine = jobs.filter(j=>j.ownerPhone===me().phone && !isFinal(j));
  if(mine.length===0){
    list.innerHTML = `<div class="empty">${t().emptyMineCustomer}</div>`;
    return;
  }
  list.innerHTML = mine.map(j=>jobCardHTML(j,false)).join('');
}

function renderHistory(){
  if(!currentUser) return;
  const list = $('historyList');
  $('historyTitle').textContent = t().historyTitle;
  if(role==='driver'){
    const done = jobs.filter(j=>j.acceptedByPhone===me().phone && isFinal(j));
    if(done.length===0){
      list.innerHTML = `<div class="empty">${t().emptyHistoryDriver}</div>`;
      return;
    }
    list.innerHTML = done.slice().sort((a,b)=>(b.completedAt||0)-(a.completedAt||0)).map(j=>jobCardHTML(j,false)).join('');
    return;
  }
  const done = jobs.filter(j=>j.ownerPhone===me().phone && isFinal(j));
  if(done.length===0){
    list.innerHTML = `<div class="empty">${t().emptyHistoryCustomer}</div>`;
    return;
  }
  list.innerHTML = done.slice().sort((a,b)=>(b.completedAt||0)-(a.completedAt||0)).map(j=>jobCardHTML(j,false)).join('');
}


/* ---------- ADMIN PANEL ---------- */
const ADM = {
  sv:{
    roleAdmin:"Admin", cancelledNote:"Uppdraget avbröts av administratör. Betalningen återbetalas till kunden.",
    releasedNote:"Betalningen släpptes av administratör.",
    tiles:{total:"Totalt", open:"Öppna", active:"Pågående", problem:"Problem", done:"Slutförda", cancelled:"Avbrutna", escrow:"Spärrat belopp", released:"Utbetalt"},
    filters:{all:"Alla", open:"Öppna", active:"Pågående", problem:"Problem", done:"Slutförda", cancelled:"Avbrutna"},
    searchPh:"Sök på id, adress, namn, telefon…", noJobs:"Inga uppdrag matchar.",
    customer:"Kund", provider:"Utförare", applicants:"Ansökningar", none:"–", id:"Id",
    created:"Skapad", arrived:"Anlände", markedDone:"Markerad klar", completed:"Avslutad",
    problemTitle:"Rapporterat problem", providerResponse:"Utförarens svar", noResponse:"Utföraren har inte svarat än.",
    resolution:"Admin-beslut", res:{released:"Betalning släppt till utföraren", refunded:"Återbetalad till kunden", cancelled:"Avbrutet", reopened:"Återöppnat"},
    noteLabel:"Intern anteckning (syns bara för admin)", notePh:"Skriv en anteckning…", saveNote:"Spara anteckning", noteSaved:"Anteckning sparad",
    release:"Släpp betalning", refund:"Återbetala kund", cancel:"Avbryt uppdrag", reopen:"Återöppna", del:"Radera",
    confirm:{release:"Släpp betalningen till utföraren och avsluta uppdraget?", refund:"Avbryt uppdraget och återbetala kunden?", cancel:"Avbryt uppdraget?", reopen:"Återöppna uppdraget så att nya utförare kan ansöka? Tilldelning och problemrapport rensas.", delete:"Radera uppdraget permanent?"},
    yes:"Bekräfta", no:"Avbryt", done:"Klart",
    usersEmpty:"Inga användare.", jobsCount:"uppdrag", delUser:"Radera användare", delUserConfirm:"Radera användaren permanent? Deras uppdrag finns kvar.", userDeleted:"Användare raderad", adminProtected:"Admin-konton raderas via databasen."
  },
  en:{
    roleAdmin:"Admin", cancelledNote:"The job was cancelled by an administrator. The payment is refunded to the customer.",
    releasedNote:"The payment was released by an administrator.",
    tiles:{total:"Total", open:"Open", active:"In progress", problem:"Problems", done:"Completed", cancelled:"Cancelled", escrow:"Held amount", released:"Paid out"},
    filters:{all:"All", open:"Open", active:"In progress", problem:"Problems", done:"Completed", cancelled:"Cancelled"},
    searchPh:"Search id, address, name, phone…", noJobs:"No jobs match.",
    customer:"Customer", provider:"Provider", applicants:"Applicants", none:"–", id:"Id",
    created:"Created", arrived:"Arrived", markedDone:"Marked done", completed:"Completed",
    problemTitle:"Reported problem", providerResponse:"Provider's response", noResponse:"The provider hasn't responded yet.",
    resolution:"Admin decision", res:{released:"Payment released to provider", refunded:"Refunded to customer", cancelled:"Cancelled", reopened:"Reopened"},
    noteLabel:"Internal note (admin only)", notePh:"Write a note…", saveNote:"Save note", noteSaved:"Note saved",
    release:"Release payment", refund:"Refund customer", cancel:"Cancel job", reopen:"Reopen", del:"Delete",
    confirm:{release:"Release the payment to the provider and close the job?", refund:"Cancel the job and refund the customer?", cancel:"Cancel the job?", reopen:"Reopen the job so new providers can apply? Assignment and problem report are cleared.", delete:"Delete the job permanently?"},
    yes:"Confirm", no:"Cancel", done:"Done",
    usersEmpty:"No users.", jobsCount:"jobs", delUser:"Delete user", delUserConfirm:"Delete this user permanently? Their jobs remain.", userDeleted:"User deleted", adminProtected:"Admin accounts are removed via the database."
  },
  ar:{
    roleAdmin:"مشرف", cancelledNote:"ألغى المشرف الطلب. سيُعاد المبلغ إلى العميل.",
    releasedNote:"حرّر المشرف الدفعة.",
    tiles:{total:"الإجمالي", open:"مفتوحة", active:"قيد التنفيذ", problem:"مشاكل", done:"مكتملة", cancelled:"ملغاة", escrow:"مبلغ محجوز", released:"مدفوع"},
    filters:{all:"الكل", open:"مفتوحة", active:"قيد التنفيذ", problem:"مشاكل", done:"مكتملة", cancelled:"ملغاة"},
    searchPh:"ابحث بالمعرّف أو العنوان أو الاسم أو الهاتف…", noJobs:"لا توجد طلبات مطابقة.",
    customer:"العميل", provider:"مقدم الخدمة", applicants:"المتقدمون", none:"–", id:"المعرّف",
    created:"أُنشئ", arrived:"وصل", markedDone:"أُعلن الإنجاز", completed:"اكتمل",
    problemTitle:"المشكلة المبلَّغ عنها", providerResponse:"ردّ مقدم الخدمة", noResponse:"لم يردّ مقدم الخدمة بعد.",
    resolution:"قرار المشرف", res:{released:"تم تحرير الدفع لمقدم الخدمة", refunded:"أُعيد المبلغ للعميل", cancelled:"ملغى", reopened:"أُعيد فتحه"},
    noteLabel:"ملاحظة داخلية (للمشرف فقط)", notePh:"اكتب ملاحظة…", saveNote:"حفظ الملاحظة", noteSaved:"تم حفظ الملاحظة",
    release:"تحرير الدفع", refund:"إعادة المبلغ للعميل", cancel:"إلغاء الطلب", reopen:"إعادة الفتح", del:"حذف",
    confirm:{release:"تحرير الدفع لمقدم الخدمة وإغلاق الطلب؟", refund:"إلغاء الطلب وإعادة المبلغ للعميل؟", cancel:"إلغاء الطلب؟", reopen:"إعادة فتح الطلب ليتقدم مقدمو خدمة جدد؟ سيُمسح التكليف وبلاغ المشكلة.", delete:"حذف الطلب نهائيًا؟"},
    yes:"تأكيد", no:"إلغاء", done:"تم",
    usersEmpty:"لا يوجد مستخدمون.", jobsCount:"طلبات", delUser:"حذف المستخدم", delUserConfirm:"حذف هذا المستخدم نهائيًا؟ تبقى طلباته.", userDeleted:"تم حذف المستخدم", adminProtected:"تُحذف حسابات المشرفين عبر قاعدة البيانات."
  }
};
function ad(){ return ADM[lang]; }

type AdminUser = { id: string; phone: string; name: string; role: Role; profiles?: string[]; createdAt?: number };
let adminFilter = 'all', adminQuery = '';
let adminUsersList: AdminUser[] = [];
let adminNotes: Record<string, string> = {};
let adminNoteDrafts: Record<string, string> = {};
let adminPending: { id: string; type: string } | null = null;
let adminPendingUser: string | null = null;

// Setters used by inline handlers in generated markup (module variables aren't reachable from onclick/oninput).
function setReportDraft(v: string){ reportDraft = v; }
function setRespondDraft(id: string, v: string){ respondDrafts[id] = v; }
function setAdminQuery(v: string){ adminQuery = v; renderAdminList(); }
function setAdminNoteDraft(id: string, v: string){ adminNoteDrafts[id] = v; }
function setAdminPendingUser(id: string | null){ adminPendingUser = id; renderAdminUsers(); }

function adminCat(j: Job): 'open' | 'active' | 'problem' | 'done' | 'cancelled' {
  if(j.status==='open') return 'open';
  if(j.status==='accepted') return j.problemReported ? 'problem' : 'active';
  return j.status; // done | cancelled
}
function fmtTime(ts: number | null | undefined): string {
  if(!ts) return ad().none;
  try{ return new Date(ts).toLocaleString({sv:'sv-SE', en:'en-GB', ar:'ar-IQ'}[lang]); }catch(e){ return String(ts); }
}
function userByPhone(phone: string | null){ return adminUsersList.find(u=>u.phone===phone); }
function userLabel(phone: string | null): string {
  if(!phone) return ad().none;
  const u = userByPhone(phone);
  return u ? `${esc(u.name)} · ${esc(phone)}` : esc(phone);
}

async function loadAdminData(){
  if(!dbRef || !sbRef || role!=='admin') return;
  try{
    const snap = await db().collection('users').get();
    adminUsersList = snap.docs.map(d=>({id:d.id, ...d.data()} as unknown as AdminUser));
  }catch(e){ console.error('load users failed', e); }
  try{
    const { data, error } = await sb().from('admin_notes').select('job_id,note');
    if(error) throw error;
    adminNotes = Object.fromEntries((data as { job_id: string; note: string }[]).map(r=>[r.job_id, r.note]));
  }catch(e){ console.error('load notes failed', e); }
  if(role==='admin') refreshCurrentScreen();
}
const loadAdminUsers = loadAdminData;

function setAdminFilter(f: string){ adminFilter = f; renderAdmin(); }

function renderAdmin(){
  if(role!=='admin') return;
  const a = ad(), d = t();
  const cnt = {open:0, active:0, problem:0, done:0, cancelled:0};
  let escrow = 0, released = 0;
  jobs.forEach(j=>{
    const c = adminCat(j); if(cnt[c]!==undefined) cnt[c]++;
    if(j.status==='accepted') escrow += j.price||0;
    if(j.status==='done' && j.paymentReleased) released += j.price||0;
  });
  const money = (n: number)=>`${n.toLocaleString(lang==='ar'?'ar-IQ':lang)} ${d.priceUnit}`;
  const tile = (label: string, val: string | number, warn = false)=>`<div class="adm-tile${warn?' warn':''}"><b>${val}</b><span>${label}</span></div>`;
  $('adminHead').innerHTML =
    `<div class="adm-stats">
      ${tile(a.tiles.total, jobs.length)}
      ${tile(a.tiles.open, cnt.open)}
      ${tile(a.tiles.active, cnt.active)}
      ${tile(a.tiles.problem, cnt.problem, cnt.problem>0)}
      ${tile(a.tiles.done, cnt.done)}
      ${tile(a.tiles.cancelled, cnt.cancelled)}
      ${tile(a.tiles.escrow, money(escrow))}
      ${tile(a.tiles.released, money(released))}
    </div>
    <div class="chip-row adm-filters">
      ${['all','open','active','problem','done','cancelled'].map(f=>
        `<div class="chip${adminFilter===f?' on':''}" onclick="setAdminFilter('${f}')">${(a.filters as Record<string,string>)[f]}${f==='all'?'':' ('+(cnt as Record<string,number>)[f]+')'}</div>`).join('')}
    </div>`;
  $<HTMLInputElement>('adminSearch').placeholder = a.searchPh;
  renderAdminList();
}

function renderAdminList(){
  if(role!=='admin') return;
  const a = ad();
  const q = adminQuery.trim().toLowerCase();
  let list = jobs.filter(j=>adminFilter==='all' || adminCat(j)===adminFilter);
  if(q){
    list = list.filter(j=>{
      const ow = userByPhone(j.ownerPhone), pr = userByPhone(j.acceptedByPhone);
      return [j.id, j.desc, j.addr, j.toAddr, j.ownerPhone, j.acceptedByPhone, ow&&ow.name, pr&&pr.name, serviceLabel(j.service), catLabel(j.service, j.cat)]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }
  list = list.slice().sort((x,y)=>{
    const px = adminCat(x)==='problem' ? 0 : 1, py = adminCat(y)==='problem' ? 0 : 1;
    return px-py || (y.createdAt||0)-(x.createdAt||0);
  });
  $('adminList').innerHTML = list.length
    ? list.map(adminJobCardHTML).join('')
    : `<div class="empty">${a.noJobs}</div>`;
}

function adminJobCardHTML(j: Job): string {
  const a = ad(), d = t();
  const applicants = Array.isArray(j.applicants) ? j.applicants : [];
  const route = j.toAddr ? `${j.addr} → ${j.toAddr}` : j.addr;
  const draft = adminNoteDrafts[j.id]!==undefined ? adminNoteDrafts[j.id] : (adminNotes[j.id]||'');
  const pend = (adminPending && adminPending.id===j.id) ? adminPending.type : null;
  const row = (label: string, val: string)=>`<div class="adm-row"><span>${label}</span><b>${val}</b></div>`;
  const appl = applicants.length ? applicants.map(x=>`${esc(x.name)} (${x.price})`).join(', ') : a.none;

  let problemBox = '';
  if(j.problemReported){
    problemBox = `<div class="adm-problem">
      <b style="color:var(--danger);">${a.problemTitle}</b> · ${fmtTime(j.problemReportedAt)}<br>“${esc(j.problemText||'')}”
      <div style="margin-top:6px;"><b>${a.providerResponse}:</b> ${j.providerResponse ? '“'+esc(j.providerResponse)+'” · '+fmtTime(j.providerResponseAt) : '<i>'+a.noResponse+'</i>'}</div>
    </div>`;
  }

  const btn = (type: 'release'|'refund'|'cancel'|'reopen'|'delete', cls?: string)=>`<button class="${cls||'secondary'}" onclick="adminAsk('${j.id}','${type}')">${a[type==='delete'?'del':type]}</button>`;
  let actions = '';
  if(j.status==='accepted') actions += btn('release') + btn('refund') + btn('reopen');
  else if(j.status==='open') actions += btn('cancel');
  else if(j.status==='cancelled') actions += btn('reopen');
  actions += btn('delete','danger');

  const confirmBox = pend ? `<div class="adm-confirm">${(a.confirm as Record<string,string>)[pend]}
      <div class="action-row">
        <button class="${pend==='delete'?'danger':'secondary'}" onclick="adminDo('${j.id}','${pend}')">${a.yes}</button>
        <button class="secondary" onclick="adminAbort()">${a.no}</button>
      </div></div>` : `<div class="action-row">${actions}</div>`;

  return `<div class="card route">
    <div class="top-row">
      <div>
        <div class="service-badge">${serviceLabel(j.service)}</div>
        <h3>${catLabel(j.service, j.cat)}</h3>
        <p class="meta">${esc(j.desc)}</p>
      </div>
      <div class="price">${j.price} ${d.priceUnit}</div>
    </div>
    <span class="status ${statusClass(j)}" style="margin-top:8px;display:inline-block;">${statusLabel(j)}</span>
    ${j.photo ? `<img src="${j.photo}" alt="" style="width:100%;max-height:140px;object-fit:cover;margin-top:10px;border:1px solid var(--line);">` : ''}
    <div style="margin-top:8px;">
      ${row(a.id, esc(j.id))}
      ${row('📍', esc(route))}
      ${row(a.customer, userLabel(j.ownerPhone))}
      ${row(a.provider, userLabel(j.acceptedByPhone))}
      ${row(a.applicants, appl)}
      ${row(a.created, fmtTime(j.createdAt))}
      ${j.arrivedAt ? row(a.arrived, fmtTime(j.arrivedAt)) : ''}
      ${j.markedDoneAt ? row(a.markedDone, fmtTime(j.markedDoneAt)) : ''}
      ${j.completedAt ? row(a.completed, fmtTime(j.completedAt)) : ''}
      ${j.resolution ? row(a.resolution, esc(a.res[j.resolution]||j.resolution) + (j.resolvedAt ? ' · '+fmtTime(j.resolvedAt) : '')) : ''}
    </div>
    ${problemBox}
    <div style="margin-top:10px;font-size:12px;color:var(--muted);">${a.noteLabel}</div>
    <textarea id="admNote-${j.id}" placeholder="${a.notePh}" oninput="setAdminNoteDraft('${j.id}', this.value)">${esc(draft)}</textarea>
    <div class="action-row"><button class="secondary" onclick="saveAdminNote('${j.id}')">${a.saveNote}</button></div>
    ${confirmBox}
  </div>`;
}

function adminAsk(id: string, type: string){ adminPending = {id, type}; renderAdminList(); }
function adminAbort(){ adminPending = null; renderAdminList(); }

async function saveAdminNote(id: string){
  if(!sbRef || role!=='admin') return;
  const text = (adminNoteDrafts[id]!==undefined ? adminNoteDrafts[id] : (adminNotes[id]||'')).trim();
  try{
    if(text){
      const { error } = await sb().from('admin_notes').upsert({job_id:id, note:text, updated_at:Date.now()});
      if(error) throw error;
      adminNotes[id] = text;
    } else {
      const { error } = await sb().from('admin_notes').delete().eq('job_id', id);
      if(error) throw error;
      delete adminNotes[id];
    }
    delete adminNoteDrafts[id];
    toast(ad().noteSaved);
  }catch(e){ toast(t().toastSaveFailed); }
}

async function adminDo(id: string, type: string){
  if(!dbRef || role!=='admin') return;
  const now = Date.now();
  const ref = db().job(id);
  let upd: JobPatch | null = null;
  if(type==='release') upd = {status:'done', paymentReleased:true, completedAt:now, resolution:'released', resolvedAt:now};
  else if(type==='refund') upd = {status:'cancelled', paymentReleased:false, completedAt:now, resolution:'refunded', resolvedAt:now};
  else if(type==='cancel') upd = {status:'cancelled', paymentReleased:false, completedAt:now, resolution:'cancelled', resolvedAt:now};
  else if(type==='reopen') upd = {status:'open', acceptedByPhone:null, arrived:false, arrivedAt:null,
    markedDoneByProvider:false, markedDoneAt:null, paymentReleased:false, completedAt:null,
    problemReported:false, problemText:null, problemReportedAt:null, providerResponse:null, providerResponseAt:null,
    autoReleased:false, resolution:'reopened', resolvedAt:now};
  try{
    if(type==='delete') await ref.delete(); else if(upd) await ref.update(upd);
    adminPending = null;
    // Make the change visible immediately, even if realtime is slow
    if(type==='delete') jobs = jobs.filter(j=>j.id!==id);
    else if(upd){ const patch = upd; jobs = jobs.map(j=>j.id===id ? {...j, ...patch} as Job : j); }
    refreshCurrentScreen();
    toast(ad().done);
  }catch(e){ console.error(e); toast(t().toastSaveFailed); }
}

function renderAdminUsers(){
  if(role!=='admin') return;
  const a = ad();
  const el = $('adminUsersList');
  if(!adminUsersList.length){ el.innerHTML = `<div class="empty">${a.usersEmpty}</div>`; return; }
  const d = t();
  const roleName = (r: Role)=> r==='admin' ? a.roleAdmin : (r==='driver' ? d.roleDriver : d.roleCustomer);
  el.innerHTML = adminUsersList.slice().sort((x,y)=>(y.createdAt||0)-(x.createdAt||0)).map(u=>{
    const n = jobs.filter(j=>j.ownerPhone===u.phone || j.acceptedByPhone===u.phone).length;
    const pend = adminPendingUser===u.id;
    const actions = u.role==='admin'
      ? `<div style="margin-top:6px;font-size:12px;color:var(--muted);">${a.adminProtected}</div>`
      : (pend
        ? `<div class="adm-confirm">${a.delUserConfirm}<div class="action-row">
            <button class="danger" onclick="adminDeleteUser('${esc(u.id)}')">${a.yes}</button>
            <button class="secondary" onclick="setAdminPendingUser(null)">${a.no}</button></div></div>`
        : `<div class="action-row"><button class="danger" onclick="setAdminPendingUser('${esc(u.id)}')">${a.delUser}</button></div>`);
    return `<div class="card">
      <div class="top-row"><div>
        <div class="service-badge">${roleName(u.role)}</div>
        <h3>${esc(u.name)}</h3>
        <p class="meta">${esc(u.phone)}</p>
      </div><div class="meta" style="font-size:12px;color:var(--muted);">${n} ${a.jobsCount}</div></div>
      <div style="margin-top:6px;font-size:12px;color:var(--muted);">${fmtTime(u.createdAt)}</div>
      ${actions}
    </div>`;
  }).join('');
}

async function adminDeleteUser(id: string){
  if(!dbRef || role!=='admin') return;
  try{
    const { error } = await sb().rpc('admin_delete_user', {uid:id});
    if(error) throw error;
    adminUsersList = adminUsersList.filter(u=>u.id!==id);
    adminPendingUser = null;
    renderAdminUsers();
    toast(ad().userDeleted);
  }catch(e){ toast(t().toastSaveFailed); }
}
/* ---------- END ADMIN PANEL ---------- */

/** Functions referenced from inline on* attributes in the markup (module scope isn't visible to those). */
export const handlers = { goTo, toggleAuthMode, submitResponse, submitRequest, submitReport, submitOffer, submitCustomOffer, submitAuth, startReport, setAdminFilter, saveProfile, saveAdminNote, saveAccountDetails, removePhoto, providerMarkDone, providerArrive, logout, handlePhotoSelect, editJob, confirmDeleteRequest, completeJob, cancelReport, cancelDelete, assignJob, askDelete, adminDo, adminDeleteUser, adminAsk, adminAbort, setReportDraft, setRespondDraft, setAdminQuery, setAdminNoteDraft, setAdminPendingUser };

export function start(){
  applyStaticText();
  void boot();
}
