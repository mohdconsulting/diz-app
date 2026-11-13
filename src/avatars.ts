/* ---------- PROFILE PHOTOS (diz_provider_avatar.sql) ----------
 * Providers must have a profile photo before they can make offers. The photo lives in the public Storage bucket
 * "avatars" under <user id>/…; users.avatar_url holds its public address. Customers get the photos of the providers
 * on their jobs via the rpc provider_avatars (the users table itself is private). */
import { $, esc, toast } from './util';
import { role, currentUser, t, me, sb, sbRef, jobs, db, dbRef } from './state';
import { refreshCurrentScreen, goTo } from './shell';
import { updateEmailNudge } from './auth';

export const AVATAR_BUCKET = 'avatars';
const SIZE = 512;                      // square, px
const MAX_BYTES = 5 * 1024 * 1024;

let photos = new Map<string, string>();   // provider phone -> url
let loadedKey = '';
let available = true;                     // false when the database doesn't have provider_avatars yet
let uploading = false;

/** Provider without a profile photo (blocks offers). Accounts on a database without the column are not blocked. */
export function providerMissingPhoto(): boolean {
  return !!currentUser && role === 'driver' && available && 'avatar_url' in me() && !me().avatar_url;
}

/** Round photo, or the first letter of the name when there is none. */
export function avatarHTML(url: string | null | undefined, name: string, size = 44): string {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;`;
  if(url) return `<img class="avatar" src="${esc(url)}" alt="" style="${style}" loading="lazy">`;
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="avatar avatar-empty" style="${style}" aria-hidden="true">${esc(letter)}</span>`;
}

/** Photo of a provider by phone (customer's view of applicants and the assigned provider). */
export function providerAvatarHTML(phone: string | null | undefined, name: string, size = 44): string {
  if(phone && currentUser && phone === me().phone) return avatarHTML(me().avatar_url, name, size);
  return avatarHTML(phone ? photos.get(phone) : null, name, size);
}

function neededPhones(): string[] {
  if(!currentUser) return [];
  const set = new Set<string>();
  for(const j of jobs){
    if(j.ownerPhone !== me().phone && role !== 'admin') continue;
    for(const a of (Array.isArray(j.applicants) ? j.applicants : [])) if(a.phone) set.add(a.phone);
    if(j.acceptedByPhone) set.add(j.acceptedByPhone);
  }
  return [...set].sort();
}

/** Called after every jobs snapshot: fetches the photos when the set of providers changed. */
export async function syncAvatars(){
  if(!sbRef || !currentUser || !available || role === 'driver') return;
  const phones = neededPhones();
  const key = phones.join(',');
  if(key === loadedKey) return;
  loadedKey = key;
  if(!phones.length) return;
  try{
    const res = await sb().rpc('provider_avatars', { p_phones: phones });
    if(res.error) throw res.error;
    photos = new Map((res.data as { phone: string; avatar_url: string }[]).map(r => [r.phone, r.avatar_url]));
    refreshCurrentScreen();
  }catch(e){ console.warn('profile photos not available', e); available = false; loadedKey = ''; }
}

/* ---------- own photo (provider profile page) ---------- */

export function renderAvatarCard(){
  const wrap = $('avatarWrap');
  if(role !== 'driver' || !currentUser){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const d = t().avatar;
  const has = !!me().avatar_url;
  $('avatarTitle').textContent = d.title;
  $('avatarRequired').textContent = has ? '' : d.required;
  $('avatarHint').textContent = d.hint;
  $('avatarPreview').innerHTML = avatarHTML(me().avatar_url, me().name, 112);
  $('avatarCameraBtn').textContent = d.takePhoto;
  $('avatarFileBtn').textContent = has ? d.change : d.choose;
  $<HTMLButtonElement>('avatarCameraBtn').disabled = uploading;
  $<HTMLButtonElement>('avatarFileBtn').disabled = uploading;
  $('avatarStatus').textContent = uploading ? d.uploading : '';
}

/** Scales and crops to a 512×512 JPEG. Falls back to the original file when the browser can't decode it. */
async function squareJpeg(file: File): Promise<Blob> {
  try{
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if(!ctx) throw new Error('no canvas');
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    bmp.close?.();
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    if(blob) return blob;
  }catch(e){ console.warn('could not resize photo, uploading as is', e); }
  return file;
}

/** Path inside the bucket from a public URL (…/object/public/avatars/<path>?v=…). */
function pathFromUrl(url: string | null | undefined): string | null {
  const m = /\/object\/public\/avatars\/([^?#]+)/.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

export async function uploadAvatar(input: HTMLInputElement){
  const file = input.files?.[0];
  input.value = '';
  if(!file || !sbRef || !dbRef || !currentUser || role !== 'driver' || uploading) return;
  const d = t().avatar;
  if(!file.type.startsWith('image/')){ toast(d.badType); return; }
  uploading = true; renderAvatarCard();
  try{
    const blob = await squareJpeg(file);
    if(blob.size > MAX_BYTES){ toast(d.tooBig); return; }
    const type = blob === file ? (file.type || 'image/jpeg') : 'image/jpeg';
    if(!['image/jpeg', 'image/png', 'image/webp'].includes(type)){ toast(d.badType); return; }
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${me().id}/${Date.now()}.${ext}`;
    const up = await sb().storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if(up.error) throw up.error;
    const url = sb().storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
    const old = pathFromUrl(me().avatar_url);
    try{ await db().user(me().id).update({ avatar_url: url }); }
    catch(e){ await sb().storage.from(AVATAR_BUCKET).remove([path]); throw e; }
    me().avatar_url = url;
    if(old && old !== path) void sb().storage.from(AVATAR_BUCKET).remove([old]);
    toast(d.saved);
  }catch(e){ console.error('avatar upload failed', e); toast(t().toastSaveFailed); }
  finally{ uploading = false; renderAvatarCard(); updateEmailNudge(); refreshCurrentScreen(); }
}

/** Admin deletes a user: remove their profile photo file too. */
export async function adminRemoveAvatar(url: string | null | undefined){
  const path = pathFromUrl(url);
  if(!path || !sbRef) return;
  try{ await sb().storage.from(AVATAR_BUCKET).remove([path]); }catch(e){ console.error('remove avatar failed', e); }
}

/** Banner/button: open the profile page at the photo. */
export function openAvatarEdit(){
  goTo('mine');
  setTimeout(() => $('avatarWrap').scrollIntoView({ block: 'center' }), 50);
}

/** The server said the provider has no photo (e.g. removed on another device). */
export function markPhotoMissing(){
  if(!currentUser) return;
  me().avatar_url = null;
  toast(t().avatar.neededToast);
  updateEmailNudge();
  refreshCurrentScreen();
}
