// Minimal typings for the part of Leaflet (loaded on demand from a CDN) that the live map uses.
export interface LLatLngBounds { extend(p: [number, number]): LLatLngBounds }
export interface LMarker { setLatLng(p: [number, number]): LMarker; addTo(m: LMap): LMarker; remove(): void }
export interface LMap {
  setView(c: [number, number], z: number): LMap;
  fitBounds(b: LLatLngBounds, o?: { padding?: [number, number]; maxZoom?: number }): LMap;
  invalidateSize(): LMap;
  remove(): void;
}
export interface Leaflet {
  map(el: HTMLElement, o?: object): LMap;
  tileLayer(url: string, o?: object): { addTo(m: LMap): unknown };
  marker(p: [number, number], o?: object): LMarker;
  divIcon(o: object): unknown;
  latLngBounds(pts: [number, number][]): LLatLngBounds;
}
declare global { interface Window { L?: Leaflet } }

const LEAFLET_VERSION = '1.9.4';
const BASE = `https://cdn.jsdelivr.net/npm/leaflet@${LEAFLET_VERSION}/dist/`;
let loading: Promise<Leaflet> | null = null;

/** Loads Leaflet only when a map is first shown, so the app itself stays a single self-contained file. */
export function loadLeaflet(): Promise<Leaflet> {
  if(window.L) return Promise.resolve(window.L);
  if(loading) return loading;
  loading = new Promise<Leaflet>((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = BASE + 'leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = BASE + 'leaflet.js';
    js.onload = () => window.L ? resolve(window.L) : reject(new Error('leaflet missing'));
    js.onerror = () => { loading = null; reject(new Error('leaflet failed to load')); };
    document.head.appendChild(js);
  });
  return loading;
}

/** OpenStreetMap standard tiles (free for light use; the attribution below is required). */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; OpenStreetMap';
