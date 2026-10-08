import { toast } from './util';
import { t, sb, sbRef, role, currentUser, jobs, locations, setLocations } from './state';
import { refreshCurrentScreen } from './shell';
import { loadLeaflet, TILE_URL, TILE_ATTRIBUTION, type LMap, type LMarker } from './leaflet';
import { mapsSearchUrl } from './util';
import type { Job, ProviderLocation } from './types';

/*
 * Live position of the provider during a job.
 *  - Provider: starts/stops sharing per job (explicit consent). The browser's geolocation is sent to the database
 *    (rpc share_location) every few seconds. Only works while the page is open — browsers pause web pages when the
 *    screen is off, so a screen wake lock is requested while sharing.
 *  - Customer: reads the newest position (row-level security shows it only to the job's customer) and shows it on a map.
 * Database rules: diz_tracking.sql (only the latest fix is stored; deleted automatically on arrival/finish).
 */

const SEND_INTERVAL_MS = 5000;   // how often the provider's position is sent
const POLL_INTERVAL_MS = 5000;   // how often the customer refreshes
const STALE_MS = 3 * 60 * 1000;  // a position older than this is shown as old

// ---------------- provider side ----------------
let sharingJobId: string | null = null;
let watchId: number | null = null;
let lastSent = 0;
let wakeLock: WakeLockSentinel | null = null;

export const isSharing = (jobId: string) => sharingJobId === jobId;

async function acquireWakeLock(){
  try{ if(navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); }catch(e){ /* optional */ }
}
function releaseWakeLock(){
  try{ if(wakeLock) void wakeLock.release(); }catch(e){ /* ignore */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if(sharingJobId && document.visibilityState === 'visible') void acquireWakeLock();   // locks are released when the tab is hidden
});

async function send(pos: GeolocationPosition){
  const now = Date.now();
  if(!sharingJobId || now - lastSent < SEND_INTERVAL_MS) return;
  lastSent = now;
  const { error } = await sb().rpc('share_location', {
    p_job_id: sharingJobId, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_accuracy: pos.coords.accuracy ?? null,
  });
  if(error) void stopSharing();   // e.g. the job is no longer eligible
}

export function toggleSharing(jobId: string){
  if(sharingJobId === jobId){ void stopSharing(true); return; }
  if(!navigator.geolocation){ toast(t().track.toastShareDenied); return; }
  void stopSharing();
  sharingJobId = jobId; lastSent = 0;
  watchId = navigator.geolocation.watchPosition(
    p => { void send(p); },
    () => { toast(t().track.toastShareDenied); void stopSharing(); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  void acquireWakeLock();
  refreshCurrentScreen();
}

export async function stopSharing(notify = false){
  const id = sharingJobId;
  if(watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; }
  releaseWakeLock();
  sharingJobId = null;
  if(id && sbRef){ try{ await sb().rpc('stop_sharing', { p_job_id: id }); }catch(e){ /* the database also cleans up */ } }
  if(notify) toast(t().track.toastShareStopped);
  if(id) refreshCurrentScreen();
}

/** Called whenever jobs are reloaded: stop sharing if the job is no longer one we may share for. */
export function syncSharing(){
  if(!sharingJobId) return;
  const j = jobs.find(x => x.id === sharingJobId);
  if(!j || j.status !== 'accepted' || j.arrived || j.markedDoneByProvider) void stopSharing();
}

/** Provider's controls on an accepted, funded, not-yet-arrived job card. */
export function providerShareHTML(j: Job): string {
  const d = t().track;
  const sub = 'margin-top:6px;font-size:12.5px;color:var(--muted);';
  return isSharing(j.id)
    ? `<div style="${sub}">${d.sharingNow}</div><div class="action-row"><button class="secondary" onclick="toggleSharing('${j.id}')">${d.stopShareBtn}</button></div>`
    : `<div style="${sub}">${d.shareNote}</div><div class="action-row"><button class="secondary" onclick="toggleSharing('${j.id}')">${d.shareBtn}</button></div>`;
}

// ---------------- customer side ----------------
type Row = Record<string, unknown>;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let channel: ReturnType<ReturnType<typeof sb>['channel']> | null = null;

function rowToLocation(r: Row): ProviderLocation {
  return { jobId: r.job_id as string, providerPhone: r.provider_phone as string, customerPhone: r.customer_phone as string,
    lat: r.lat as number, lng: r.lng as number, accuracy: (r.accuracy as number) ?? null, updatedAt: r.updated_at as number };
}

export async function loadLocations(){
  if(!sbRef || !currentUser) return;
  try{
    const { data, error } = await sb().from('provider_locations').select('*');
    if(error) throw error;
    const next = (data as Row[]).map(rowToLocation);
    const changed = JSON.stringify(next) !== JSON.stringify(locations);
    setLocations(next);
    if(changed) refreshCurrentScreen();
  }catch(e){ console.error('locations load failed', e); }
}

/** Customers poll (and listen for realtime events) while signed in; providers only need stopSharing on sign-out. */
export function startTracking(){
  stopTracking();
  if(!sbRef || role !== 'customer') return;
  void loadLocations();
  pollTimer = setInterval(() => { void loadLocations(); }, POLL_INTERVAL_MS);
  channel = sb().channel('locations-' + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_locations' }, () => { void loadLocations(); })
    .subscribe();
}
export function stopTracking(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  if(channel && sbRef){ sb().removeChannel(channel); channel = null; }
  setLocations([]);
  openJobId = null; destroyMap();
  void stopSharing();
}

export const locationFor = (jobId: string) => locations.find(l => l.jobId === jobId);

function agoText(ms: number): string {
  const d = t().track, s = Math.max(0, Math.round(ms / 1000));
  return d.ago.replace('{t}', s < 60 ? `${s} ${d.sec}` : `${Math.round(s / 60)} ${d.min}`);
}

/** Customer's tracking block for an accepted job that the provider has not arrived at yet. */
export function customerTrackingHTML(j: Job): string {
  const d = t().track, sub = 'margin-top:6px;font-size:12.5px;color:var(--muted);';
  if(j.arrived || j.markedDoneByProvider) return '';
  const loc = locationFor(j.id);
  if(!loc) return `<div style="${sub}">${d.notSharing}</div>`;
  const age = Date.now() - loc.updatedAt, old = age > STALE_MS;
  return `<div style="margin-top:8px;font-size:13px;">${d.onTheWay} · <span style="color:var(--muted)">${agoText(age)}</span></div>
    ${old ? `<div style="${sub}color:var(--danger);">${d.stale}</div>` : ''}
    <div class="action-row">
      <button class="secondary" onclick="toggleTrackMap('${j.id}')">${openJobId === j.id ? d.hideMap : d.showMap}</button>
      <a class="maplink" style="align-self:center;font-size:13px;" href="${mapsSearchUrl({ text: null, lat: loc.lat, lng: loc.lng })}" target="_blank" rel="noopener noreferrer">${d.openProvider}</a>
    </div>
    ${openJobId === j.id ? `<div class="track-slot" id="trackSlot-${j.id}"></div>` : ''}`;
}

// ---------------- the live map ----------------
let openJobId: string | null = null;
let mapNode: HTMLDivElement | null = null;
let map: LMap | null = null;
let providerMarker: LMarker | null = null;
let destMarker: LMarker | null = null;
let fitted = false;

function destroyMap(){
  if(map) map.remove();
  if(mapNode) mapNode.remove();
  map = null; mapNode = null; providerMarker = null; destMarker = null; fitted = false;
}

export function toggleTrackMap(jobId: string){
  openJobId = openJobId === jobId ? null : jobId;
  if(!openJobId) destroyMap();
  fitted = false;
  refreshCurrentScreen();
}

/**
 * Called after every screen render (the card HTML is rebuilt each time, which would destroy a map living inside it).
 * The map's DOM node is kept and moved into the freshly rendered slot, so the map survives updates.
 */
export async function mountTrackingMap(){
  if(!openJobId) return;
  const jobId = openJobId;
  const slot = document.getElementById('trackSlot-' + jobId);
  const loc = locationFor(jobId);
  if(!slot || !loc) return;
  let L;
  try{ L = await loadLeaflet(); }catch(e){ slot.textContent = t().track.mapFailed; return; }
  const slot2 = document.getElementById('trackSlot-' + jobId);   // may have been re-rendered while Leaflet loaded
  const cur = locationFor(jobId);
  if(!slot2 || !cur || openJobId !== jobId) return;
  if(!mapNode){ mapNode = document.createElement('div'); mapNode.className = 'live-map'; }
  if(mapNode.parentElement !== slot2) slot2.appendChild(mapNode);
  if(!map){
    map = L.map(mapNode);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
  }
  const icon = (emoji: string) => L.divIcon({ html: emoji, className: 'live-marker', iconSize: [28, 28], iconAnchor: [14, 14] });
  const pos: [number, number] = [cur.lat, cur.lng];
  if(providerMarker) providerMarker.setLatLng(pos); else providerMarker = L.marker(pos, { icon: icon('🚚') }).addTo(map);
  const job = jobs.find(x => x.id === jobId);
  if(job && job.addrLat != null && job.addrLng != null){
    const dest: [number, number] = [job.addrLat, job.addrLng];
    if(destMarker) destMarker.setLatLng(dest); else destMarker = L.marker(dest, { icon: icon('📍') }).addTo(map);
  }
  map.invalidateSize();
  if(!fitted){   // frame the markers once; afterwards leave the view alone so the customer can pan and zoom freely
    if(job && job.addrLat != null && job.addrLng != null) map.fitBounds(L.latLngBounds([pos, [job.addrLat, job.addrLng]]), { padding: [30, 30], maxZoom: 16 });
    else map.setView(pos, 15);
    fitted = true;
  }
}
