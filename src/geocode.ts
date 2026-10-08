/*
 * Address suggestions while typing. Provider: Photon (https://photon.komoot.io, OpenStreetMap data) — free, no API key,
 * built for search-as-you-type. The typed text is sent to that service. To switch provider (e.g. Google Places),
 * replace searchPlaces(); the rest of the app only uses PlaceSuggestion.
 */
export interface PlaceSuggestion { label: string; lat: number; lng: number }

const PHOTON_URL = 'https://photon.komoot.io/api/';
const BIAS = { lat: 33.3152, lon: 44.3661 };   // Baghdad: nudges results towards Iraq without excluding anywhere

type Props = Record<string, string | undefined>;
interface Feature { geometry?: { coordinates?: [number, number] }; properties?: Props }

function labelFor(p: Props): string {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const parts = [p.name, street, p.district || p.locality, p.city || p.county, p.state];
  if(p.countrycode && p.countrycode.toUpperCase() !== 'IQ' && p.country) parts.push(p.country);
  const seen = new Set<string>();
  return parts.filter((x): x is string => !!x && !seen.has(x) && !!seen.add(x)).join(', ');
}

export async function searchPlaces(query: string, signal: AbortSignal): Promise<PlaceSuggestion[]> {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=6&lat=${BIAS.lat}&lon=${BIAS.lon}&location_bias_scale=0.5`;
  const res = await fetch(url, { signal });
  if(!res.ok) return [];
  const data = await res.json() as { features?: Feature[] };
  const out: PlaceSuggestion[] = [];
  const seen = new Set<string>();
  for(const f of data.features || []){
    const c = f.geometry && f.geometry.coordinates;
    const label = labelFor(f.properties || {});
    if(!c || !label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, lat: Math.round(c[1] * 1e6) / 1e6, lng: Math.round(c[0] * 1e6) / 1e6 });
  }
  return out;
}
