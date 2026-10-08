

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

/** An address with an optional GPS pin. With a pin, Google Maps opens the exact spot; otherwise it searches the text. */
export interface Place { text: string | null | undefined; lat?: number | null; lng?: number | null }
const hasPin = (p: Place) => typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng);
const mapsTarget = (p: Place) => hasPin(p) ? `${p.lat},${p.lng}` : String(p.text ?? '').trim();

/** Google Maps URLs (no API key needed): a search for one place, or directions between two. */
export function mapsSearchUrl(p: Place): string {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapsTarget(p));
}
export function mapsRouteUrl(from: Place, to: Place): string {
  return 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(mapsTarget(from)) + '&destination=' + encodeURIComponent(mapsTarget(to));
}
/** A place as a link that opens it in Google Maps (new tab / the Maps app on phones). */
export function mapLink(p: Place, title: string): string {
  const text = String(p.text ?? '').trim();
  if(!text && !hasPin(p)) return '';
  return `<a class="maplink" href="${esc(mapsSearchUrl(p))}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">📍 ${esc(text || mapsTarget(p))}</a>`;
}
/** Pickup (and optional destination) as Maps links, plus a directions link when there are two. */
export function routeLinksHTML(j: { addr: string | null; toAddr: string | null; addrLat?: number | null; addrLng?: number | null; toLat?: number | null; toLng?: number | null },
                               openTitle: string, routeLabel: string): string {
  const from: Place = { text: j.addr, lat: j.addrLat, lng: j.addrLng };
  const to: Place = { text: j.toAddr, lat: j.toLat, lng: j.toLng };
  if(!j.toAddr) return mapLink(from, openTitle);
  const dir = (from.text || hasPin(from))
    ? ` <a class="maplink" href="${esc(mapsRouteUrl(from, to))}" target="_blank" rel="noopener noreferrer">🧭 ${esc(routeLabel)}</a>` : '';
  return `${mapLink(from, openTitle)} → ${mapLink(to, openTitle)}${dir}`;
}
