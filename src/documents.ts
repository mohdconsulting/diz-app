/* ---------- PROVIDER DOCUMENTS (verification) ----------
 * Files live in the private Storage bucket "provider-docs" under <user id>/…; the table provider_documents lists them.
 * Only the provider and admin can read them (diz_provider_documents.sql). Admin opens them via short-lived signed URLs. */
import { $, esc, toast } from './util';
import { role, currentUser, t, me, sb, sbRef } from './state';

export const DOC_BUCKET = 'provider-docs';
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DOCS = 20;

export interface ProviderDoc { id: string; user_id: string; kind: string; file_path: string; file_name: string; mime?: string | null; size_bytes?: number | null; created_at: string }

let myDocs: ProviderDoc[] = [];
let uploading = false;

export function docKindLabel(kind: string): string {
  const d = t().docs;
  return ({ id: d.kId, license: d.kLicense, certificate: d.kCertificate, other: d.kOther } as Record<string, string>)[kind] ?? kind;
}

export async function loadMyDocs(){
  if(!sbRef || !currentUser || role !== 'driver') return;
  try{
    const { data, error } = await sb().from('provider_documents').select('*').eq('user_id', me().id);
    if(error) throw error;
    myDocs = ((data as ProviderDoc[]) || []).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  }catch(e){ console.error('load documents failed', e); myDocs = []; }
  renderDocs();
}

export function renderDocs(){
  const wrap = $('docsWrap');
  if(role !== 'driver' || !currentUser){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const d = t().docs;
  $('docsTitle').textContent = d.title;
  $('docsHint').textContent = d.hint;
  $('docCameraBtn').textContent = d.takePhoto;
  $('docFilesBtn').textContent = d.chooseFiles;
  $<HTMLButtonElement>('docCameraBtn').disabled = uploading;
  $<HTMLButtonElement>('docFilesBtn').disabled = uploading;
  if(!uploading) $('docsStatus').textContent = '';
  $('docsList').innerHTML = myDocs.length
    ? myDocs.map(doc => `<div class="card" style="padding:10px 12px;margin-bottom:8px;">
        <div class="top-row"><div>
          <p class="meta" style="word-break:break-all;margin:0;">📄 ${esc(doc.file_name)}</p>
        </div><button class="danger" onclick="deleteDoc('${esc(doc.id)}')">${d.remove}</button></div>
      </div>`).join('')
    : `<div class="empty" style="margin-bottom:8px;">${d.empty}</div>`;
}

/** Uploads the photo or files chosen in one of the hidden inputs (camera or file picker), one after another. */
export async function uploadDocs(input: HTMLInputElement){
  if(!sbRef || !currentUser || role !== 'driver' || uploading) return;
  const d = t().docs;
  const files = Array.from(input.files ?? []);
  input.value = '';                       // the same file can be chosen again later
  if(!files.length) return;
  uploading = true; renderDocs();
  let done = 0;
  try{
    for(const [i, file] of files.entries()){
      $('docsStatus').textContent = d.uploadingN.replace('{n}', String(i + 1)).replace('{total}', String(files.length));
      if(file.size > MAX_BYTES){ toast(d.tooBig); continue; }
      const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
      if(!(mime.startsWith('image/') || mime === 'application/pdf')){ toast(d.badType); continue; }
      if(myDocs.length + done >= MAX_DOCS){ toast(d.tooMany); break; }
      const ext = (file.name.split('.').pop() || (mime === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
      const path = `${me().id}/${crypto.randomUUID()}.${ext}`;
      try{
        const up = await sb().storage.from(DOC_BUCKET).upload(path, file, { contentType: mime, upsert: false });
        if(up.error) throw up.error;
        const { error } = await sb().from('provider_documents').insert({ user_id: me().id, kind: 'id', file_path: path, file_name: (file.name || 'photo.jpg').slice(0, 200), mime, size_bytes: file.size });
        if(error){ await sb().storage.from(DOC_BUCKET).remove([path]); throw error; }
        done++;
      }catch(e){ console.error(e); toast(t().toastSaveFailed); }
    }
    if(done) toast(done === 1 ? d.uploaded : d.uploadedN.replace('{n}', String(done)));
    await loadMyDocs();
  }finally{ uploading = false; renderDocs(); }
}

export async function deleteDoc(id: string){
  if(!sbRef || !currentUser) return;
  const doc = myDocs.find(x => x.id === id); if(!doc) return;
  try{
    const { error } = await sb().from('provider_documents').delete().eq('id', id);
    if(error) throw error;
    await sb().storage.from(DOC_BUCKET).remove([doc.file_path]);
    toast(t().docs.deleted);
    await loadMyDocs();
  }catch(e){ console.error(e); toast(t().toastSaveFailed); }
}

/* --- admin --- */
let docsByUser: Record<string, ProviderDoc[]> = {};
export async function loadAllDocs(){
  if(!sbRef || role !== 'admin') return;
  try{
    const { data, error } = await sb().from('provider_documents').select('*');
    if(error) throw error;
    docsByUser = {};
    for(const doc of (data as ProviderDoc[]) || []) (docsByUser[doc.user_id] ??= []).push(doc);
  }catch(e){ console.error('load documents failed', e); docsByUser = {}; }
}
/** Before admin deletes a user: remove their files from Storage (the table rows go with the user). */
export async function adminRemoveUserFiles(userId: string){
  const paths = (docsByUser[userId] || []).map(d => d.file_path);
  if(!paths.length || !sbRef) return;
  try{ await sb().storage.from(DOC_BUCKET).remove(paths); }catch(e){ console.error('remove files failed', e); }
  delete docsByUser[userId];
}
export function adminDocsHTML(userId: string): string {
  const d = t().docs;
  const list = docsByUser[userId] || [];
  const items = list.length
    ? list.map(doc => `<div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
        <span style="font-size:16px;flex:1;word-break:break-all;"><b>${esc(docKindLabel(doc.kind))}:</b> ${esc(doc.file_name)}</span>
        <button class="secondary" style="padding:4px 10px;" onclick="adminOpenDoc('${esc(doc.file_path)}')">${d.open}</button></div>`).join('')
    : `<span style="font-size:16px;color:var(--muted);">${d.adminNone}</span>`;
  return `<div style="margin-top:8px;"><div style="font-size:16px;font-weight:600;">${d.title}</div>${items}</div>`;
}
export async function adminOpenDoc(path: string){
  if(!sbRef || role !== 'admin') return;
  const win = window.open('', '_blank');   // open synchronously so the popup isn't blocked
  try{
    const { data, error } = await sb().storage.from(DOC_BUCKET).createSignedUrl(path, 300);
    if(error || !data) throw error ?? new Error('no url');
    if(win) win.location.href = data.signedUrl; else location.href = data.signedUrl;
  }catch(e){ console.error(e); win?.close(); toast(t().toastSaveFailed); }
}
