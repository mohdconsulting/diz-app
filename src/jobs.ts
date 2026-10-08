import { $ } from './util';
import { priceFor } from './pricing';
import { attachPlaceSearch, closeSuggestions } from './place-search';
import { I18N, type Service } from './i18n';
import { type Job, type ServiceKey } from './types';
import { esc, toast, routeLinksHTML, PIN_ADDR } from './util';
import { role, paymentsMode, selectedService, setSelectedService, selectedCat, setSelectedCat, selectedSize, setSelectedSize, useCustomPrice, setUseCustomPrice, editingJobId, setEditingJobId, photoDataUrl, setPhotoDataUrl, jobs, dbRef, currentUser, t, me, db } from './state';
import { seenSet, shownSigs, jobEvent } from './notifications';
import { renderAccountEdit, renderProfileEdit } from './auth';
import { goTo, refreshCurrentScreen } from './shell';
import { ad } from './admin';
import { dropSharing, providerShareHTML, customerTrackingHTML } from './tracking';
import { startPayment, openJobPaymentHTML, customerPaymentHTML, providerPaymentHTML, settledPaymentHTML, isFunded } from './payments';

/** GPS pins chosen in the request form (optional). Sent with the job so the driver's Maps link is exact. */
type Pin = { lat: number; lng: number } | null;
let addrPin: Pin = null, toPin: Pin = null;
/** True while a pin came from a picked suggestion (it must be dropped if the text is edited afterwards). */
let addrPinFromSearch = false, toPinFromSearch = false;
const roundCoord = (n: number) => Math.round(n * 1e6) / 1e6;

export function renderPins(){
  const d = t();
  const row = (id: string, pin: Pin, which: 'addr'|'to') => {
    $(id).innerHTML = pin
      ? `<span>📍 ${d.locationSavedNote} (${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)})</span><button type="button" class="secondary" onclick="clearPin('${which}')">${d.removePinBtn}</button>`
      : `<button type="button" class="secondary" onclick="useMyLocation('${which}')">📍 ${d.useMyLocationBtn}</button>`;
  };
  row('addrPinRow', addrPin, 'addr');
  row('toPinRow', toPin, 'to');
}
export function useMyLocation(which: 'addr'|'to'){
  if(!navigator.geolocation){ toast(t().toastLocationFailed); return; }
  navigator.geolocation.getCurrentPosition(pos=>{
    const pin = { lat: roundCoord(pos.coords.latitude), lng: roundCoord(pos.coords.longitude) };
    if(which === 'addr'){ addrPin = pin; addrPinFromSearch = false; } else { toPin = pin; toPinFromSearch = false; }
    // The address text is required; if it is empty, a pin alone is enough to fill it in.
    const input = $<HTMLInputElement>(which === 'addr' ? 'addrInput' : 'toAddrInput');
    if(!input.value.trim()) input.value = t().myLocationText;
    renderPins();
  }, ()=>toast(t().toastLocationFailed), { enableHighAccuracy: true, timeout: 15000 });
}
export function clearPin(which: 'addr'|'to'){
  if(which === 'addr'){ addrPin = null; addrPinFromSearch = false; } else { toPin = null; toPinFromSearch = false; }
  renderPins();
}

function setupPlaceSearch(){
  const wire = (inputId: string, listId: string, which: 'addr'|'to') => attachPlaceSearch({
    input: $<HTMLInputElement>(inputId), list: $(listId),
    onPick: s => {
      const pin = { lat: s.lat, lng: s.lng };
      if(which === 'addr'){ addrPin = pin; addrPinFromSearch = true; } else { toPin = pin; toPinFromSearch = true; }
      renderPins();
    },
    onEdit: () => {
      if(which === 'addr' && addrPinFromSearch){ addrPin = null; addrPinFromSearch = false; renderPins(); }
      if(which === 'to' && toPinFromSearch){ toPin = null; toPinFromSearch = false; renderPins(); }
    },
  });
  wire('addrInput', 'addrSuggest', 'addr');
  wire('toAddrInput', 'toSuggest', 'to');
}
setupPlaceSearch();

export function renderRequestDetails(){
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
  renderPins();
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


export function handlePhotoSelect(e: Event){
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
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      setPhotoDataUrl(dataUrl);
      $<HTMLImageElement>('photoPreviewImg').src = dataUrl;
      $('photoPreviewWrap').style.display = 'block';
    };
    img.src = String(ev.target?.result ?? '');
  };
  reader.readAsDataURL(file);
}

export function removePhoto(){
  setPhotoDataUrl(null);
  $<HTMLInputElement>('photoInput').value = '';
  $('photoPreviewWrap').style.display = 'none';
}

export function resetNewRequestForm(){
  setEditingJobId(null);
  setSelectedService(null); setSelectedCat(null); setSelectedSize(null); setUseCustomPrice(false);
  setPhotoDataUrl(null);
  $<HTMLInputElement>('photoInput').value = '';
  $('photoPreviewWrap').style.display = 'none';
  document.querySelectorAll('#serviceChips .chip, #catChips .chip, #sizeChips .chip').forEach(c=>c.classList.remove('on'));
  $('requestDetails').style.display = 'none';
  $<HTMLInputElement>('descInput').value = '';
  $<HTMLInputElement>('addrInput').value = '';
  if($('toAddrInput')) $<HTMLInputElement>('toAddrInput').value = '';
  addrPin = null; toPin = null; addrPinFromSearch = false; toPinFromSearch = false;
  closeSuggestions($('addrSuggest')); closeSuggestions($('toSuggest'));
  $('customPriceChip').classList.remove('on');
  $('customPriceWrap').style.display = 'none';
  $<HTMLInputElement>('customPriceInput').value = '';
  $('submitBtn').textContent = t().submitBtn;
  updateEstimate();
}


$('serviceChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  document.querySelectorAll<HTMLElement>('#serviceChips .chip').forEach(c=>c.classList.remove('on'));
  chip.classList.add('on');
  setSelectedService(chip.dataset.val as ServiceKey);
  setSelectedCat(null); setSelectedSize(null); setUseCustomPrice(false);
  $('customPriceChip').classList.remove('on');
  $('customPriceWrap').style.display = 'none';
  renderRequestDetails();
  updateEstimate();
});
$('catChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  document.querySelectorAll('#catChips .chip').forEach(c=>c.classList.remove('on'));
  chip.classList.add('on'); setSelectedCat(chip.dataset.val ?? null); updateEstimate();
});
$('sizeChips').addEventListener('click', e=>{
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if(!chip) return;
  document.querySelectorAll('#sizeChips .chip').forEach(c=>c.classList.remove('on'));
  chip.classList.add('on'); setSelectedSize(parseInt(chip.dataset.val as string)); updateEstimate();
});

$('customPriceChip').addEventListener('click', ()=>{
  setUseCustomPrice(!useCustomPrice);
  $('customPriceChip').classList.toggle('on', useCustomPrice);
  $('customPriceWrap').style.display = useCustomPrice ? 'block' : 'none';
  if(useCustomPrice){
    const input = $<HTMLInputElement>('customPriceInput');
    if(!input.value && selectedSize && selectedService) input.value = String(priceFor(selectedService, selectedSize, selectedCat));
  }
  updateEstimate();
});
$('customPriceInput').addEventListener('input', updateEstimate);

export function updateEstimate(){
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

export async function providerArrive(id: string){
  if(!dbRef) return;
  try{
    await db().job(id).update({arrived:true, arrivedAt:Date.now()});
    dropSharing(id);   // arrival ends position sharing (the database also removes the stored position)
    toast(t().toastProviderArrived);
  }catch(e){ toast(t().toastSaveFailed); }
}

export async function providerMarkDone(id: string){
  if(!dbRef) return;
  try{
    await db().job(id).update({markedDoneByProvider:true, markedDoneAt:Date.now()});
    toast(t().toastProviderMarkedDone);
  }catch(e){ toast(t().toastSaveFailed); }
}

export async function completeJob(id: string){
  if(!dbRef) return;
  const j = jobs.find(x=>x.id===id);
  if(!j || !(j.arrived || j.markedDoneByProvider)) return;
  try{
    await db().job(id).update({status:'done', paymentReleased:true, completedAt:Date.now()});
    toast(t().toastJobCompleted);
  }catch(e){ toast(t().toastSaveFailed); }
}

export const REPORT_WINDOW_MS = 5*86400000; // customer may report a problem for 5 days after the provider marks the job done
export let reportingId: string | null = null, reportDraft = '';
export function startReport(id: string){ reportingId = id; reportDraft = ''; refreshCurrentScreen(); }
export function cancelReport(){ reportingId = null; reportDraft = ''; refreshCurrentScreen(); }
export async function submitReport(id: string){
  const text = reportDraft.trim();
  if(!text){ toast(t().toastReportEmpty); return; }
  if(!dbRef) return;
  try{
    await db().job(id).update({problemReported:true, problemText:text, problemReportedAt:Date.now()});
    reportingId = null; reportDraft = '';
    toast(t().toastProblemReported);
  }catch(e){ toast(t().toastSaveFailed); }
}
export let respondDrafts: Record<string, string> = {};
export async function submitResponse(id: string){
  const text = (respondDrafts[id]||'').trim();
  if(!text){ toast(t().toastResponseEmpty); return; }
  if(!dbRef) return;
  try{
    await db().job(id).update({providerResponse:text, providerResponseAt:Date.now()});
    delete respondDrafts[id];
    toast(t().toastResponseSent);
  }catch(e){ toast(t().toastSaveFailed); }
}
export function fmtRemaining(ms: number): string {
  if(ms<0) ms = 0;
  const d = Math.floor(ms/86400000), h = Math.floor((ms%86400000)/3600000);
  return t().remainingFmt.replace('{d}', String(d)).replace('{h}', String(h));
}
// Client-side fallback; the database (pg_cron) does the same on the server.
export const autoReleasing = new Set();
export async function autoReleaseExpired(){
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

export let pendingDeleteId: string | null = null;

export function askDelete(id: string){
  pendingDeleteId = id;
  refreshCurrentScreen();
}
export function cancelDelete(){
  pendingDeleteId = null;
  refreshCurrentScreen();
}
export async function confirmDeleteRequest(id: string){
  if(!dbRef) return;
  try{
    await db().job(id).delete();
    if(editingJobId === id) resetNewRequestForm();
    pendingDeleteId = null;
    toast(t().toastRequestDeleted);
  }catch(e){ toast(t().toastSaveFailed); }
}

export function editJob(id: string){
  const j = jobs.find(x=>x.id===id);
  if(!j || j.status !== 'open') return;
  goTo('new');
  setEditingJobId(id);
  setSelectedService(j.service);
  setSelectedCat(j.cat);
  setSelectedSize(j.size);
  const computedPrice = priceFor(j.service, j.size, j.cat);
  setUseCustomPrice((j.price !== computedPrice));

  document.querySelectorAll<HTMLElement>('#serviceChips .chip').forEach(c=>c.classList.toggle('on', c.dataset.val===selectedService));
  renderRequestDetails();
  $<HTMLInputElement>('descInput').value = j.desc ?? '';
  setPhotoDataUrl(j.photo || null);
  if(photoDataUrl){
    $<HTMLImageElement>('photoPreviewImg').src = photoDataUrl;
    $('photoPreviewWrap').style.display = 'block';
  } else {
    $('photoPreviewWrap').style.display = 'none';
  }
  $<HTMLInputElement>('addrInput').value = j.addr === PIN_ADDR ? t().myLocationText : (j.addr ?? '');
  if($('toAddrInput')) $<HTMLInputElement>('toAddrInput').value = j.toAddr === PIN_ADDR ? t().myLocationText : (j.toAddr || '');
  addrPin = (j.addrLat != null && j.addrLng != null) ? { lat: j.addrLat, lng: j.addrLng } : null;
  toPin = (j.toLat != null && j.toLng != null) ? { lat: j.toLat, lng: j.toLng } : null;
  $('customPriceChip').classList.toggle('on', useCustomPrice);
  $('customPriceWrap').style.display = useCustomPrice ? 'block' : 'none';
  if(useCustomPrice) $<HTMLInputElement>('customPriceInput').value = String(j.price);
  updateEstimate();
  $('submitBtn').textContent = t().saveChangesBtn;
}

/** The pin label typed/filled by "use my location" is stored as a language-neutral marker (translated when shown). */
function storedAddr(text: string, pin: Pin): string {
  const labels = Object.values(I18N).flatMap(dict => [dict.myLocationText, dict.customerLocationText]);
  if(labels.includes(text)) return pin ? PIN_ADDR : '';   // label without a pin (pin removed) is not a real address
  return text;
}

function pinFields(toAddr: string | null) {
  return {
    addrLat: addrPin ? addrPin.lat : null, addrLng: addrPin ? addrPin.lng : null,
    toLat: toAddr && toPin ? toPin.lat : null, toLng: toAddr && toPin ? toPin.lng : null,
  };
}

export async function submitRequest(){
  const d = t();
  if(!dbRef){ toast(d.toastDbUnavailable); return; }
  const desc = $<HTMLInputElement>('descInput').value.trim();
  const addr = storedAddr($<HTMLInputElement>('addrInput').value.trim(), addrPin);
  if(!selectedService){ toast(d.toastMissingFields); return; }
  const service: ServiceKey = selectedService;
  const svc = d.services[service];
  const toAddr = svc.needsToAddr ? storedAddr($<HTMLInputElement>('toAddrInput').value.trim(), toPin) : null;
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
      await db().job(editingJobId).update({service, cat:selectedCat, desc, addr, toAddr, size:selectedSize, price, photo: photoDataUrl || null, ...pinFields(toAddr)});
    } else {
      await db().collection('jobs').add({
        service, cat:selectedCat, desc, addr, toAddr, size:selectedSize, price, ...pinFields(toAddr),
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

export function svcDict(service: string): Service | undefined { return (t().services as Record<string, Service>)[service]; }
export function catLabel(service: string, key: string | null): string { return (key && svcDict(service)?.categories?.[key]) || key || ''; }
export function serviceLabel(service: string): string { return svcDict(service)?.label || service; }
export function effectiveStatusKey(j: Job): 'open' | 'accepted' | 'arrived' | 'problem' | 'done' | 'cancelled' {
  if(j.status==='accepted' && j.problemReported) return 'problem';
  if(j.status==='accepted' && (j.arrived || j.markedDoneByProvider)) return 'arrived';
  return j.status;
}
export function statusLabel(j: Job): string { return t().status[effectiveStatusKey(j)]; }
export function statusClass(j: Job): string { return {open:"waiting", accepted:"accepted", arrived:"accepted", problem:"problem", done:"done", cancelled:"done"}[effectiveStatusKey(j)]; }
export function isFinal(j: Job): boolean { return j.status==='done' || j.status==='cancelled'; }
export function roleLabel(){ const d=t(); return role==='admin' ? ad().roleAdmin : (role==='driver' ? d.roleDriver : d.roleCustomer); }

export function submitOffer(id: string){
  const j = jobs.find(x=>x.id===id);
  if(!j) return;
  applyToJob(id, j.price);
}

export function submitCustomOffer(id: string){
  const input = $<HTMLInputElement>('offerInput-'+id);
  const val = parseInt(input.value, 10);
  if(!val || val<=0){ toast(t().toastInvalidOffer); return; }
  applyToJob(id, val);
}

export async function applyToJob(id: string, price: number){
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

export async function assignJob(id: string, phone: string){
  if(!dbRef) return;
  const j = jobs.find(x=>x.id===id);
  if(!j) return;
  const applicants = Array.isArray(j.applicants) ? j.applicants : [];
  const chosen = applicants.find(a=>a.phone===phone);
  if(!chosen) return;
  // With payments on, "assign" and "pay" are one step: the job is assigned by the database once the money is secured.
  if(paymentsMode !== 'off'){ await startPayment(id, phone); return; }
  try{
    await db().job(id).update({status:'accepted', acceptedByPhone: phone, price: chosen.price});
    toast(t().toastAssigned);
  }catch(e){ toast(t().toastSaveFailed); }
}

export function jobCardHTML(j: Job, courierView: boolean): string {
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
              <button class="secondary" onclick="assignJob('${j.id}','${a.phone}')">${paymentsMode !== 'off' ? d.pay.assignPayBtn.replace('{amount}', a.price + ' ' + d.priceUnit) : d.assignBtn}</button>
            </div>
          </div>`).join('')
        : `<div class="empty" style="padding:14px;">${d.noApplicantsYet}</div>`;
      const checkout = openJobPaymentHTML(j);
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
      ${checkout || `<div style="margin-top:10px;">
        <p class="section-title" style="margin-bottom:8px;">${d.applicantsTitle}${applicants.length ? ' (' + applicants.length + ')' : ''}</p>
        ${applicantsHtml}
      </div>`}
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
      const payBlock = customerPaymentHTML(j);
      const funded = paymentsMode === 'off' || isFunded(j.id);
      let actions = '';
      if(!funded){
        actions = '';
        note = '';
      } else if(reportingId===j.id && !j.problemReported){
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
      ${payBlock}
      ${funded ? customerTrackingHTML(j) : ''}
      ${note}
      ${actions}`;
    } else if(j.status==='accepted' && role==='driver' && isMyAcceptedJob && providerPaymentHTML(j).blocking){
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
      ${providerPaymentHTML(j).html}`;
    } else if(j.status==='accepted' && role==='driver' && isMyAcceptedJob){
      const payLine = providerPaymentHTML(j).html;
      let problemNote = payLine;
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
        ${payLine}
        ${providerShareHTML(j)}
        <div class="action-row">
          <button class="secondary" onclick="providerArrive('${j.id}')">${d.providerArriveBtn}</button>
        </div>`;
      }
    } else if(j.status==='cancelled'){
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
      <div style="margin-top:6px;font-size:12px;color:var(--muted);">${ad().cancelledNote}</div>
      ${settledPaymentHTML(j, role==='driver')}`;
    } else if(j.status==='done'){
      body = `<span class="status ${statusClass(j)}">${statusLabel(j)}</span>
      <div style="margin-top:6px;font-size:12px;color:var(--muted);">${j.resolution==='released' ? ad().releasedNote : (j.autoReleased ? d.autoReleasedNote : d.paymentReleasedNote)}</div>
      ${settledPaymentHTML(j, role==='driver')}`;
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
    <p class="meta" style="margin-top:8px;">${routeLinksHTML(j, d.openInMaps, d.mapsRoute, isMine ? d.myLocationText : d.customerLocationText)}</p>
    ${body}
  </div>`;
}

export function renderHome(){
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

export function providerCanTake(job: Job): boolean {
  if(!currentUser || !me().profiles || me().profiles.length===0) return true;
  const profiles = me().profiles;
  if(profiles.includes('driver') && (job.service==='junk' || job.service==='moving' || job.service==='goods' || job.service==='deliver')) return true;
  if(job.service==='pro' && profiles.includes(job.cat ?? '')) return true;
  if(job.service==='towing' && profiles.includes('towing')) return true;
  return false;
}

export function renderJobs(){
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

export function renderMine(){
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

export function renderHistory(){
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



export function setReportDraft(v: string){ reportDraft = v; }
export function setRespondDraft(id: string, v: string){ respondDrafts[id] = v; }
