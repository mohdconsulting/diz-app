import { startPayments, stopPayments } from './payments';
import { startTracking, stopTracking } from './tracking';
import { startChat, stopChat } from './chat';
import { startCalls, stopCalls } from './call';
import { loadDismissals, clearDismissals } from './dismissals';
import { clearReviews } from './reviews';
import { $ } from './util';
import { createSupabaseDbShim, SUPABASE_URL, SUPABASE_ANON_KEY } from './db';
import { type AppUser } from './types';
import { toast } from './util';
import { lang, role, setRole, setJobs, dbRef, setDbRef, currentUser, setCurrentUser, authMode, setAuthMode, authSelectedRole, setAuthSelectedRole, authSelectedProfiles, setAuthSelectedProfiles, editProfiles, setEditProfiles, t, me, db, sb, sbRef, setSbRef, unsubJobs, setUnsubJobs } from './state';
import { setSeenSet, setShownSigs, setNotifiedSigs, setFirstSnapshotDone, loadSeen, unseenEvents, markShownSeen, updateBadges } from './notifications';
import { subscribeJobs, applyRoleUI, goTo, refreshCurrentScreen } from './shell';
import { roleLabel } from './jobs';
import { setAdminUsersList, setAdminNotes, loadAdminData } from './admin';

/* ---------- AUTH ---------- */
export function toggleAuthMode(){
  setAuthMode(authMode === 'login' ? 'register' : 'login');
  setAuthSelectedRole(null);
  setAuthSelectedProfiles(new Set());
  renderAuth();
}

export function profileOptions(){
  const d = t();
  const opts = [{key:'driver', label:d.profileDriver}, {key:'towing', label:d.profileTowing}];
  Object.entries(d.services.pro.categories).forEach(([key,label])=>{
    opts.push({key, label});
  });
  return opts;
}

/** Which part of the sign-in card is shown: the normal form, "forgot password", or "choose a new password". */
let authPanel: 'main' | 'forgot' | 'reset' = 'main';

export function isValidEmail(v: string): boolean { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()); }

export function renderAuth(){
  const d = t();
  const isRegister = authMode === 'register';
  $('authMainWrap').style.display = authPanel === 'main' ? 'block' : 'none';
  $('authForgotWrap').style.display = authPanel === 'forgot' ? 'block' : 'none';
  $('authResetWrap').style.display = authPanel === 'reset' ? 'block' : 'none';
  $('forgotPhoneLabel').textContent = d.authPhoneLabel;
  $('forgotSendBtn').textContent = d.forgotSend;
  $('forgotBackBtn').textContent = d.forgotBack;
  $('resetNewLabel').textContent = d.resetNewLabel;
  $('resetRepeatLabel').textContent = d.resetRepeatLabel;
  $('resetSaveBtn').textContent = d.resetSave;
  if(authPanel === 'forgot'){ $('authTitle').textContent = d.forgotTitle; $('authSubtitle').textContent = d.forgotText; return; }
  if(authPanel === 'reset'){ $('authTitle').textContent = d.resetTitle; $('authSubtitle').textContent = ''; return; }
  $('authTitle').textContent = isRegister ? d.authTitleRegister : d.authTitleLogin;
  $('authSubtitle').textContent = isRegister ? d.authSubtitleRegister : d.authSubtitleLogin;
  $('authEmailWrap').style.display = isRegister ? 'block' : 'none';
  $('authEmailLabel').textContent = d.authEmailLabel;
  $('authForgotRow').style.display = isRegister ? 'none' : 'block';
  $('authForgotBtn').textContent = d.forgotLink;
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
    $('authShareNote').textContent = d.authShareNote;
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
  setAuthSelectedRole((chip.dataset.val as 'customer' | 'driver'));
  if(authSelectedRole !== 'driver') setAuthSelectedProfiles(new Set());
  renderAuth();
});
$('authProfileChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  const key = chip.dataset.val as string;
  if(authSelectedProfiles.has(key)) authSelectedProfiles.delete(key);
  else authSelectedProfiles.add(key);
  renderAuth();
});


// Supabase Auth needs an email-shaped id and rejects domains without mail servers, so each phone number is mapped to
// diz.<digits>@gmail.com. No mail is ever sent (Confirm email must be OFF). To use your own domain, change the constants.
export const AUTH_EMAIL_PREFIX = 'diz.';
export const AUTH_EMAIL_DOMAIN = 'gmail.com';
export function authEmail(phone: string): string {
  const local = phone.replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
  return local ? AUTH_EMAIL_PREFIX + local + '@' + AUTH_EMAIL_DOMAIN : '';
}
export async function loadProfile(uid: string): Promise<boolean> {
  if(!dbRef) return false;
  const snap = await db().user(uid).get();
  const data = snap.data();
  if(!snap.exists || !data) return false;
  const user = {id:uid, ...data} as unknown as AppUser;
  setCurrentUser(user);
  setRole(user.role);
  return true;
}

export async function submitAuth(){
  const d = t();
  if(!dbRef || !sbRef){ toast(d.toastDbUnavailable); return; }
  const phone = $<HTMLInputElement>('authPhoneInput').value.trim();
  const pass = $<HTMLInputElement>('authPassInput').value;
  const email = authEmail(phone);
  if(authMode === 'register'){
    const name = $<HTMLInputElement>('authNameInput').value.trim();
    const realEmail = $<HTMLInputElement>('authEmailInput').value.trim().toLowerCase();
    if(!name || !phone || !pass || !email || !realEmail){ toast(d.toastAuthMissingFields); return; }
    if(!isValidEmail(realEmail)){ toast(d.toastInvalidEmail); return; }
    if(!authSelectedRole){ toast(d.toastAuthMissingRole); return; }
    if(authSelectedRole==='driver' && authSelectedProfiles.size===0){ toast(d.toastAuthMissingProfiles); return; }
    if(pass.length < 6){ toast(d.toastPasswordShort); return; }
    const profiles = authSelectedRole==='driver' ? Array.from(authSelectedProfiles) : [];
    try{
      const { data, error } = await sb().auth.signUp({
        email, password: pass,
        options: { data: { name, phone, role: authSelectedRole, profiles, email: realEmail } }
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

export function enterApp(){
  $('authOverlay').style.display = 'none';
  $<HTMLInputElement>('authPhoneInput').value = '';
  $<HTMLInputElement>('authPassInput').value = '';
  $<HTMLInputElement>('authNameInput').value = '';
  $<HTMLInputElement>('authEmailInput').value = '';
  authPanel = 'main';
  setAuthSelectedRole(null);
  loadSeen();
  setShownSigs(new Set());
  setNotifiedSigs(new Set(unseenEvents().map(e=>e.sig)));
  updateUserRow();
  applyRoleUI();
  if(!unsubJobs) setUnsubJobs(subscribeJobs());
  void startPayments();
  startTracking();
  startChat();
  startCalls();
  void loadDismissals();
  if(role==='admin') loadAdminData();
  goTo(role==='admin' ? 'admin' : (role==='driver' ? 'jobs' : 'home'));
}

export function updateUserRow(){
  if(!currentUser) return;
  const d = t();
  $('userGreeting').textContent =
    `${d.greetingPrefix}, ${me().name} · ${roleLabel()}`;
  $('logoutBtn').textContent = d.logoutBtn;
  updateEmailNudge();
}

/** Accounts made before e-mail was required are asked to add one (needed for password reset). */
export function updateEmailNudge(){
  const show = !!currentUser && role !== 'admin' && !me().email;
  $('emailNudge').style.display = show ? 'block' : 'none';
  if(!show) return;
  $('emailNudgeText').textContent = t().emailNudge;
  $('emailNudgeBtn').textContent = t().emailNudgeBtn;
}
export function openEmailEdit(){
  goTo('mine');
  setTimeout(()=>{ const el = $<HTMLInputElement>('accountEmailInput'); el.scrollIntoView({block:'center'}); el.focus(); }, 50);
}

/* ---------- FORGOTTEN PASSWORD ---------- */
export function openForgot(){
  authPanel = 'forgot';
  $<HTMLInputElement>('forgotPhoneInput').value = $<HTMLInputElement>('authPhoneInput').value;
  $('forgotNote').textContent = '';
  renderAuth();
}
export function closeForgot(){ authPanel = 'main'; renderAuth(); }

export async function sendResetLink(){
  const d = t();
  const phone = $<HTMLInputElement>('forgotPhoneInput').value.trim();
  if(!phone || !authEmail(phone)){ toast(d.toastAuthMissingFields); return; }
  if(!sbRef){ toast(d.toastDbUnavailable); return; }
  const btn = $<HTMLButtonElement>('forgotSendBtn');
  btn.disabled = true;
  try{
    // The function always answers ok, so nobody can tell which numbers have accounts.
    const { error } = await sb().functions.invoke('request-password-reset', { body: { phone, lang } });
    if(error) throw error;
    $('forgotNote').textContent = d.forgotSent;
  }catch(e){ console.error(e); toast(d.toastSaveFailed); }
  finally{ btn.disabled = false; }
}

/** Opened from the e-mailed link (?reset_token=…): exchange the one-time token for a session, then ask for a password. */
async function handleResetLink(): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  const token = params.get('reset_token');
  if(!token) return false;
  params.delete('reset_token'); params.delete('lang');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  const { error } = await sb().auth.verifyOtp({ token_hash: token, type: 'recovery' });
  if(error){ console.error(error); toast(t().toastResetLinkInvalid); return false; }
  authPanel = 'reset';
  renderAuth();
  $('authOverlay').style.display = 'flex';
  return true;
}

export async function saveNewPassword(){
  const d = t();
  const p1 = $<HTMLInputElement>('resetNewInput').value;
  const p2 = $<HTMLInputElement>('resetRepeatInput').value;
  if(p1.length < 6){ toast(d.toastPasswordShort); return; }
  if(p1 !== p2){ toast(d.toastPasswordMismatch); return; }
  const btn = $<HTMLButtonElement>('resetSaveBtn');
  btn.disabled = true;
  try{
    const { data, error } = await sb().auth.updateUser({ password: p1 });
    if(error || !data.user){ console.error(error); toast(d.toastResetLinkInvalid); return; }
    $<HTMLInputElement>('resetNewInput').value = ''; $<HTMLInputElement>('resetRepeatInput').value = '';
    toast(d.toastPasswordChanged);
    authPanel = 'main';
    if(await loadProfile(data.user.id)) enterApp(); else renderAuth();
  }catch(e){ console.error(e); toast(d.toastSaveFailed); }
  finally{ btn.disabled = false; }
}

export async function logout(){
  markShownSeen();
  if(unsubJobs){ unsubJobs(); setUnsubJobs(null); }
  stopPayments();
  stopTracking();
  stopChat();
  stopCalls();
  clearDismissals();
  clearReviews();
  setJobs([]); setFirstSnapshotDone(false);
  setAdminUsersList([]); setAdminNotes({});
  try{ if(sbRef) await sb().auth.signOut(); }catch(e){}
  setCurrentUser(null);
  setSeenSet(new Set()); setShownSigs(new Set()); setNotifiedSigs(new Set());
  updateBadges();
  setEditProfiles(null);
  setAuthMode('login');
  authPanel = 'main';
  renderAuth();
  updateEmailNudge();
  $('authOverlay').style.display = 'flex';
}

export function renderAccountEdit(){
  $('accountEditTitle').textContent = t().accountEditTitle;
  $('accountNameLabel').textContent = t().authNameLabel;
  $('accountPhoneLabel').textContent = t().authPhoneLabel;
  $('accountEmailLabel').textContent = t().authEmailLabel;
  const emailInput = $<HTMLInputElement>('accountEmailInput');
  if(document.activeElement !== emailInput) emailInput.value = me().email ?? '';
  $('accountSaveBtn').textContent = t().accountSaveBtn;
  const nameInput = $<HTMLInputElement>('accountNameInput');
  const phoneInput = $<HTMLInputElement>('accountPhoneInput');
  if(document.activeElement !== nameInput) nameInput.value = me().name;
  phoneInput.value = me().phone;
  phoneInput.disabled = true; // phone number is the login id and can't be changed
}

export async function saveAccountDetails(){
  if(!dbRef || !currentUser) return;
  const d = t();
  const newName = $<HTMLInputElement>('accountNameInput').value.trim();
  const newEmail = $<HTMLInputElement>('accountEmailInput').value.trim().toLowerCase();
  if(!newName || !newEmail){ toast(d.toastAuthMissingFields); return; }
  if(!isValidEmail(newEmail)){ toast(d.toastInvalidEmail); return; }
  // Providers also save their skills with the same button.
  const isProvider = role === 'driver';
  const profiles = isProvider ? Array.from(editProfiles ?? new Set(me().profiles || [])) : null;
  if(isProvider && (!profiles || profiles.length===0)){ toast(d.toastAuthMissingProfiles); return; }
  try{
    await db().user(me().id).update(profiles ? {name:newName, email:newEmail, profiles} : {name:newName, email:newEmail});
    me().name = newName;
    me().email = newEmail;
    if(profiles) me().profiles = profiles;
    toast(d.toastAccountSaved);
    updateUserRow();
    if(profiles) refreshCurrentScreen();
  }catch(e){ toast(d.toastSaveFailed); }
}

export function renderProfileEdit(){
  const wrap = $('profileEditWrap');
  if(role !== 'driver' || !currentUser){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if(!editProfiles) setEditProfiles(new Set(me().profiles || []));
  const ep: Set<string> = editProfiles ?? new Set();
  $('profileEditTitle').textContent = t().profileEditTitle;
  $('profileEditChips').innerHTML = profileOptions().map(o=>
    `<div class="chip${ep.has(o.key)?' on':''}" data-val="${o.key}">${o.label}</div>`
  ).join('');
}

$('profileEditChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  const key = chip.dataset.val as string;
  if(!editProfiles) return;
  if(editProfiles.has(key)) editProfiles.delete(key); else editProfiles.add(key);
  chip.classList.toggle('on');
});

/* ---------- BOOT ---------- */
export async function boot(){
  $('authNote').textContent = t().authConnecting;
  $<HTMLInputElement>('authSubmitBtn').disabled = true;

  try{
    if(!window.supabase) throw new Error('supabase-js not loaded');
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    setSbRef(client);
    setDbRef(createSupabaseDbShim(client));
  }catch(e){ setDbRef(null); setSbRef(null); }

  $('authNote').textContent = '';
  $<HTMLInputElement>('authSubmitBtn').disabled = false;

  if(!dbRef){
    toast(t().toastDbUnavailable);
    $('authOverlay').style.display = 'flex';
    return;
  }

  // Opened from a password-reset e-mail?
  try{ if(await handleResetLink()) return; }catch(e){ console.error(e); }

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
