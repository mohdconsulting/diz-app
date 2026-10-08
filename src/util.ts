

/** getElementById that fails loudly instead of returning null. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if(!el) throw new Error('missing element #' + id);
  return el as T;
}

export const ESC_MAP: Record<string, string> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
export function esc(s: unknown): string { return String(s==null?'':s).replace(/[&<>"']/g, c=>ESC_MAP[c]); }


export function toast(msg: string){
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), msg.length>60 ? 6000 : 1800);
}

export function sanitizePhone(phone: string){
  return phone.replace(/[^a-zA-Z0-9_\-.~:@+]/g, '');
}
export function rememberPhone(phone: string){ try{ localStorage.setItem('diz_last_phone', phone); }catch(e){} }
export function forgetPhone(){ try{ localStorage.removeItem('diz_last_phone'); }catch(e){} }
export function safeGetLocal(k: string){ try{ return localStorage.getItem(k); }catch(e){ return null; } }

/** Google Maps URLs (no API key needed): a search for one address, or directions between two. */
export function mapsSearchUrl(addr: string): string {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
}
export function mapsRouteUrl(from: string, to: string): string {
  return 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(from) + '&destination=' + encodeURIComponent(to);
}
/** An address as a link that opens it in Google Maps (new tab / the Maps app on phones). */
export function mapLink(addr: string | null | undefined, title: string): string {
  const a = String(addr ?? '').trim();
  if(!a) return '';
  return `<a class="maplink" href="${esc(mapsSearchUrl(a))}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">📍 ${esc(a)}</a>`;
}
/** Pickup (and optional destination) addresses as Maps links, plus a directions link when there are two. */
export function routeLinksHTML(addr: string | null, toAddr: string | null, openTitle: string, routeLabel: string): string {
  const from = mapLink(addr, openTitle);
  if(!toAddr) return from;
  const dir = addr ? ` <a class="maplink" href="${esc(mapsRouteUrl(addr, toAddr))}" target="_blank" rel="noopener noreferrer">🧭 ${esc(routeLabel)}</a>` : '';
  return `${from} → ${mapLink(toAddr, openTitle)}${dir}`;
}
