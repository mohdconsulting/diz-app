import { adminPaymentHTML, paymentFor, adminSettlePayment, loadPayments } from './payments';
import { $ } from './util';
import { type Role, type Job, type JobPatch } from './types';
import { esc, toast, routeLinksHTML } from './util';
import { lang, role, jobs, setJobs, dbRef, t, db, sb, sbRef } from './state';
import { refreshCurrentScreen } from './shell';
import { chatHTML, mountChat } from './chat';
import { adminReviewHTML } from './reviews';
import { catLabel, serviceLabel, statusLabel, statusClass } from './jobs';

/* ---------- ADMIN PANEL ---------- */
export const ADM = {
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
export function ad(){ return ADM[lang]; }

export type AdminUser = { id: string; phone: string; name: string; role: Role; profiles?: string[]; createdAt?: number };
export let adminFilter = 'all', adminQuery = '';
export let adminUsersList: AdminUser[] = [];
export let adminNotes: Record<string, string> = {};
export let adminNoteDrafts: Record<string, string> = {};
export let adminPending: { id: string; type: string } | null = null;
export let adminPendingUser: string | null = null;

// Setters used by inline handlers in generated markup (module variables aren't reachable from onclick/oninput).

export function setAdminQuery(v: string){ adminQuery = v; renderAdminList(); }
export function setAdminNoteDraft(id: string, v: string){ adminNoteDrafts[id] = v; }
export function setAdminPendingUser(id: string | null){ adminPendingUser = id; renderAdminUsers(); }

export function adminCat(j: Job): 'open' | 'active' | 'problem' | 'done' | 'cancelled' {
  if(j.status==='open') return 'open';
  if(j.status==='accepted') return j.problemReported ? 'problem' : 'active';
  return j.status; // done | cancelled
}
export function fmtTime(ts: number | null | undefined): string {
  if(!ts) return ad().none;
  try{ return new Date(ts).toLocaleString({sv:'sv-SE', en:'en-GB', ar:'ar-IQ'}[lang]); }catch(e){ return String(ts); }
}
export function userByPhone(phone: string | null){ return adminUsersList.find(u=>u.phone===phone); }
export function userLabel(phone: string | null): string {
  if(!phone) return ad().none;
  const u = userByPhone(phone);
  return u ? `${esc(u.name)} · ${esc(phone)}` : esc(phone);
}

export async function loadAdminData(){
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
export const loadAdminUsers = loadAdminData;

export function setAdminFilter(f: string){ adminFilter = f; renderAdmin(); }

export function renderAdmin(){
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

export function renderAdminList(){
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
  mountChat();
}

export function adminJobCardHTML(j: Job): string {
  const a = ad(), d = t();
  const applicants = Array.isArray(j.applicants) ? j.applicants : [];
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

  const confirmBox = pend ? `<div class="adm-confirm">${pend==='payout' ? d.pay.confirmPayout : pend==='payrefund' ? d.pay.confirmRefund : (a.confirm as Record<string,string>)[pend]}
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
      ${row('📍', routeLinksHTML(j, d.openInMaps, d.mapsRoute, d.customerLocationText))}
      ${row(a.customer, userLabel(j.ownerPhone))}
      ${row(a.provider, userLabel(j.acceptedByPhone))}
      ${row(a.applicants, appl)}
      ${adminPaymentHTML(j)}
      ${row(a.created, fmtTime(j.createdAt))}
      ${j.arrivedAt ? row(a.arrived, fmtTime(j.arrivedAt)) : ''}
      ${j.markedDoneAt ? row(a.markedDone, fmtTime(j.markedDoneAt)) : ''}
      ${j.completedAt ? row(a.completed, fmtTime(j.completedAt)) : ''}
      ${j.resolution ? row(a.resolution, esc(a.res[j.resolution]||j.resolution) + (j.resolvedAt ? ' · '+fmtTime(j.resolvedAt) : '')) : ''}
    </div>
    ${problemBox}
    ${j.acceptedByPhone ? chatHTML(j, true) : ''}
    ${adminReviewHTML(j)}
    <div style="margin-top:10px;font-size:12px;color:var(--muted);">${a.noteLabel}</div>
    <textarea id="admNote-${j.id}" placeholder="${a.notePh}" oninput="setAdminNoteDraft('${j.id}', this.value)">${esc(draft)}</textarea>
    <div class="action-row"><button class="secondary" onclick="saveAdminNote('${j.id}')">${a.saveNote}</button></div>
    ${confirmBox}
  </div>`;
}

export function adminAsk(id: string, type: string){ adminPending = {id, type}; renderAdminList(); }
export function adminAbort(){ adminPending = null; renderAdminList(); }

export async function saveAdminNote(id: string){
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

export async function adminDo(id: string, type: string){
  if(!dbRef || role!=='admin') return;
  if(type==='payout' || type==='payrefund'){
    const p = paymentFor(id);
    if(p) await adminSettlePayment(p.id, type==='payout' ? 'payout' : 'refund');
    adminPending = null;
    refreshCurrentScreen();
    return;
  }
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
    if(type==='delete') setJobs(jobs.filter(j=>j.id!==id));
    else if(upd){ const patch = upd; setJobs(jobs.map(j=>j.id===id ? {...j, ...patch} as Job : j)); }
    void loadPayments();
    refreshCurrentScreen();
    toast(ad().done);
  }catch(e){ console.error(e); toast(t().toastSaveFailed); }
}

export function renderAdminUsers(){
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

export async function adminDeleteUser(id: string){
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

export function setAdminUsersList(v: typeof adminUsersList){ adminUsersList = v; }

export function setAdminNotes(v: typeof adminNotes){ adminNotes = v; }
