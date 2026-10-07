

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
