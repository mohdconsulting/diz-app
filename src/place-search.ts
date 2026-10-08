import { esc } from './util';
import { searchPlaces, type PlaceSuggestion } from './geocode';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

interface Options {
  input: HTMLInputElement;
  list: HTMLElement;
  /** The user picked a suggestion: the text is already in the input; the caller stores the coordinates. */
  onPick(s: PlaceSuggestion): void;
  /** The user typed (so any pin that came from an earlier suggestion no longer matches the text). */
  onEdit(): void;
}

/** Incremental address search: suggestions under the input while typing, with keyboard and touch support. */
export function attachPlaceSearch({ input, list, onPick, onEdit }: Options){
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | null = null;
  let items: PlaceSuggestion[] = [];
  let active = -1;

  const close = () => { items = []; active = -1; list.hidden = true; list.innerHTML = ''; };
  const paint = () => {
    list.innerHTML = items.map((s, i) =>
      `<div class="suggest-item${i === active ? ' on' : ''}" role="option" data-i="${i}">📍 ${esc(s.label)}</div>`).join('');
    list.hidden = items.length === 0;
  };
  const pick = (i: number) => {
    const s = items[i];
    if(!s) return;
    input.value = s.label;
    close();
    onPick(s);
  };

  input.setAttribute('autocomplete', 'off');
  list.setAttribute('role', 'listbox');

  input.addEventListener('input', () => {
    onEdit();
    clearTimeout(timer);
    if(ctrl) ctrl.abort();
    const q = input.value.trim();
    if(q.length < MIN_CHARS){ close(); return; }
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      try{
        items = await searchPlaces(q, ctrl.signal);
        active = -1;
        paint();
      }catch(e){ close(); }   // offline / blocked / aborted: typing still works, just without suggestions
    }, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', e => {
    if(list.hidden) return;
    if(e.key === 'ArrowDown'){ active = (active + 1) % items.length; paint(); e.preventDefault(); }
    else if(e.key === 'ArrowUp'){ active = (active - 1 + items.length) % items.length; paint(); e.preventDefault(); }
    else if(e.key === 'Enter' && active >= 0){ pick(active); e.preventDefault(); }
    else if(e.key === 'Escape'){ close(); }
  });

  // mousedown (not click) so it fires before the input loses focus
  list.addEventListener('mousedown', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.suggest-item');
    if(el){ e.preventDefault(); pick(Number(el.dataset.i)); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

/** Hide and clear a suggestion list (e.g. when the form is reset). */
export function closeSuggestions(list: HTMLElement){ list.hidden = true; list.innerHTML = ''; }
