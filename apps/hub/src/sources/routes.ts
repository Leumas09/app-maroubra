// Routes des vols par indicatif : API publique adsbdb.com (sans clé), qui remplace « routeset » d'adsb.lol
// (réponses vides depuis le 20/11/2026). Les réponses, connues ou non, sont gardées 12 h ; les appels
// sont espacés d'au moins 1 s et limités à quelques indicatifs nouveaux par relevé.
import { fetchText } from "../http";

export interface RouteAirport { iata: string; icao?: string; name: string; location: string; lat?: number; lon?: number }
/** Même forme que l'ancienne réponse de « routeset », lue par normalize(). */
export interface Route { callsign: string; airport_codes: string; _airport_codes_iata?: string; _airports: RouteAirport[]; plausible?: boolean | number; at: number }

interface RawAirport { iata_code?: string; icao_code?: string; name?: string; municipality?: string; latitude?: number; longitude?: number }
interface RawFlightRoute { callsign?: string; origin?: RawAirport; destination?: RawAirport }

const KEEP_MS = 12 * 3600e3;
const GAP_MS = 1000;

const airport = (a: RawAirport): RouteAirport => ({
  iata: a.iata_code ?? a.icao_code ?? "?", icao: a.icao_code, name: a.name ?? "", location: a.municipality ?? a.name ?? "",
  ...(typeof a.latitude === "number" && typeof a.longitude === "number" ? { lat: a.latitude, lon: a.longitude } : {}),
});

/** Réponse d'adsbdb vers notre forme ; null si l'indicatif est inconnu. */
export function parseAdsbdb(body: string, callsign: string, at: number): Route | null {
  let j: { response?: { flightroute?: RawFlightRoute } | string };
  try { j = JSON.parse(body); } catch { return null; }
  const fr = typeof j.response === "object" ? j.response.flightroute : undefined;
  if (!fr?.origin || !fr.destination) return null;
  const list = [airport(fr.origin), airport(fr.destination)];
  return {
    callsign, at, plausible: true, _airports: list,
    airport_codes: list.map((a) => a.icao ?? a.iata).join("-"), _airport_codes_iata: list.map((a) => a.iata).join("-"),
  };
}

export type RouteCache = Map<string, Route | { at: number; unknown: true }>;

export function routeLookup(cache: RouteCache, get: (url: string) => Promise<{ status: number; body: string }> = defaultGet) {
  let next = 0;
  const pending = new Set<string>();
  const one = async (cs: string) => {
    const wait = Math.max(0, next - Date.now());
    next = Math.max(Date.now(), next) + GAP_MS;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const res = await get(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`);
    if (res.status === 404) return cache.set(cs, { at: Date.now(), unknown: true });
    if (res.status !== 200) return; // panne passagère : on réessaiera
    cache.set(cs, parseAdsbdb(res.body, cs, Date.now()) ?? { at: Date.now(), unknown: true });
  };
  /** Lance la recherche des indicatifs inconnus ou périmés (au plus `max`), sans attendre la réponse. */
  return (callsigns: string[], max = 5) => {
    const now = Date.now();
    const todo = [...new Set(callsigns)].filter((cs) => /^[A-Z0-9]{2,8}$/.test(cs) && !pending.has(cs) && (!cache.has(cs) || now - cache.get(cs)!.at > KEEP_MS)).slice(0, max);
    for (const cs of todo) {
      pending.add(cs);
      void one(cs).catch(() => {}).finally(() => pending.delete(cs));
    }
    return todo;
  };
}

async function defaultGet(url: string): Promise<{ status: number; body: string }> {
  try {
    return { status: 200, body: await fetchText(url, { timeoutMs: 10_000 }) };
  } catch (err) {
    const m = String((err as Error).message ?? err).match(/^(\d{3})/);
    return { status: m ? Number(m[1]) : 0, body: "" };
  }
}

/** Route connue pour un indicatif (null si inconnue ou pas encore cherchée). */
export const knownRoute = (cache: RouteCache, cs: string | null): Route | undefined => {
  const r = cs ? cache.get(cs) : undefined;
  return r && !("unknown" in r) ? r : undefined;
};
