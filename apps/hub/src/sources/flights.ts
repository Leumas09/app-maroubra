// Avions autour de Maroubra : positions ADS-B d'adsb.fi (open data, une requête par seconde autorisée),
// adsb.lol en secours (500 appels par jour sans clé : au plus toutes les 5 min), routes d'adsbdb.com.
// Un grand relevé de 250 NM toutes les 30 s alimente l'historique des traces (history.ts).
// On déduit le mode de pistes de Sydney, le couvre-feu et les survols imminents, jugés sur la trace réelle.
import type { Aircraft, Airport, Flights, OverheadOutcome } from "@maroubra/core";
import { airlineOf } from "./airlines";
import { SITE } from "../config";
import { bearingDeg, destination, distanceKm } from "../geo";
import { fetchJson } from "../http";
import type { Collector } from "../collector";
import { FlightHistory } from "./history";
import { routeLookup, type RouteCache } from "./routes";

const YSSY = { lat: -33.9461, lon: 151.1772 };
const RADIUS_NM = 25;
const WIDE_EVERY_MS = 30_000;
const WIDE_NM = 250;
const FALLBACK_EVERY_MS = 5 * 60e3;
const ADSB_FI = `https://opendata.adsb.fi/api/v2/lat/${SITE.lat}/lon/${SITE.lon}/dist/${RADIUS_NM}`;
const ADSB_LOL = `https://api.adsb.lol/v2/point/${SITE.lat}/${SITE.lon}/${RADIUS_NM}`;

/**
 * adsb.fi autorise une requête par seconde : toutes nos requêtes (relevé de la maison et zones demandées
 * par la carte) passent par ce guichet, qui les espace d'au moins 1,1 s.
 */
let fiNext = 0;
async function fetchFi(url: string): Promise<{ ac?: RawAc[]; aircraft?: RawAc[] }> {
  const wait = Math.max(0, fiNext - Date.now());
  fiNext = Math.max(Date.now(), fiNext) + 1100;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return fetchJson(url);
}

/** Les deux agrégateurs servent le format readsb : liste sous « aircraft » (adsb.fi) ou « ac » (adsb.lol). */
export const aircraftList = (j: { ac?: RawAc[]; aircraft?: RawAc[] }): RawAc[] => j.aircraft ?? j.ac ?? [];

/** Types rares à Sydney, pour l'alerte « avion remarquable ». */
const RARE: Record<string, string> = {
  A388: "Airbus A380", B744: "Boeing 747-400", B748: "Boeing 747-8", A124: "Antonov An-124", A225: "Antonov An-225",
  C17: "C-17 Globemaster", A400: "Airbus A400M", C130: "C-130 Hercules", C30J: "C-130J Hercules", K35R: "KC-135",
  CONC: "Concorde", B52: "B-52", P8: "P-8 Poseidon", E7WW: "E-7 Wedgetail", FA18: "F/A-18", F35: "F-35",
  SPIT: "Spitfire", DC3: "Douglas DC-3", CAT: "Catalina",
};

export interface RawAc {
  hex: string; flight?: string; r?: string; t?: string; desc?: string; ownOp?: string; year?: string | number; category?: string; type?: string;
  alt_baro?: number | "ground"; gs?: number; track?: number; baro_rate?: number; geom_rate?: number; lat?: number; lon?: number;
  emergency?: string; squawk?: string; dbFlags?: number; seen_pos?: number;
}

interface RawAirport { iata: string; icao?: string; name: string; location: string; lat?: number; lon?: number }
interface RawRoute { callsign: string; airport_codes: string; _airport_codes_iata?: string; _airports: RawAirport[]; plausible?: boolean | number }

/** Urgences : champ « emergency » de readsb, ou à défaut code transpondeur réservé. */
const EMERGENCY: Record<string, string> = {
  general: "General emergency", lifeguard: "Medical emergency", minfuel: "Minimum fuel", nordo: "Radio failure",
  unlawful: "Unlawful interference", downed: "Aircraft down",
};
const SQUAWK: Record<string, string> = { "7700": "general", "7600": "nordo", "7500": "unlawful" };

export function emergencyOf(r: Pick<RawAc, "emergency" | "squawk">): string | null {
  const e = r.emergency && r.emergency !== "none" ? r.emergency : r.squawk ? SQUAWK[r.squawk] : undefined;
  return e ? EMERGENCY[e] ?? null : null;
}

const SOURCE: [RegExp, string][] = [[/^ads[br]_/, "ADS-B"], [/^mlat$/, "MLAT"], [/^tisb_/, "TIS-B"], [/^adsc$/, "ADS-C (satellite)"], [/^mode_s$/, "Mode S"]];
const sourceOf = (t?: string) => (t ? SOURCE.find(([re]) => re.test(t))?.[1] ?? null : null);

const hasPos = (a?: RawAirport): a is RawAirport & { lat: number; lon: number } => a != null && typeof a.lat === "number" && typeof a.lon === "number";

/**
 * Étape en cours d'une route à escales : celle qui fait le moins de détour par la position de l'avion.
 * L'avancement est une mesure de distance le long de l'étape, pas une heure d'arrivée.
 */
export function currentLeg(airports: RawAirport[], lat: number, lon: number): { from?: RawAirport; to?: RawAirport; progress: Aircraft["progress"] } {
  let best: { i: number; detour: number } | null = null;
  for (let i = 0; i + 1 < airports.length; i++) {
    const a = airports[i], b = airports[i + 1];
    if (!hasPos(a) || !hasPos(b)) continue;
    const detour = distanceKm(a.lat, a.lon, lat, lon) + distanceKm(lat, lon, b.lat, b.lon) - distanceKm(a.lat, a.lon, b.lat, b.lon);
    if (!best || detour < best.detour) best = { i, detour };
  }
  if (!best) return { from: airports[0], to: airports.at(-1), progress: null };
  const from = airports[best.i] as RawAirport & { lat: number; lon: number }, to = airports[best.i + 1] as RawAirport & { lat: number; lon: number };
  const flown = distanceKm(from.lat, from.lon, lat, lon), left = distanceKm(lat, lon, to.lat, to.lon);
  return { from, to, progress: { pct: Math.round((flown / (flown + left)) * 1000) / 10, flownKm: Math.round(flown), leftKm: Math.round(left) } };
}

/**
 * Avion en manoeuvre d'arrivée : sous 9 000 ft, sans monter, à moins de 45 km de l'aéroport et pas aligné
 * sur la finale de la piste 25 (la seule qui passe au-dessus de Maroubra). Le contrôle le fait encore
 * tourner (vent arrière, base) : prolonger sa trajectoire en ligne droite ne vaut rien. Règle établie
 * sur l'enregistrement ADS-B du 21/11/2026 avant 20:50 UTC, jugée ensuite sur la suite (bench/results).
 */
export function inArrivalManoeuvre(a: { lat: number; lon: number; track: number | null; altFt?: number | null; vrate?: number | null }): boolean {
  if (a.altFt == null || a.altFt >= 9000 || (a.vrate ?? 0) > 300) return false;
  if (distanceKm(a.lat, a.lon, YSSY.lat, YSSY.lon) > 45) return false;
  return !(a.track != null && a.track >= 230 && a.track <= 270);
}

/** Survol prévu : on prolonge la trajectoire en ligne droite 8 minutes et on cherche le passage le plus proche. */
export function predictOverhead(a: { lat: number; lon: number; track: number | null; speedKt: number | null; altFt?: number | null; vrate?: number | null }, home = SITE): Aircraft["overhead"] {
  if (a.track == null || !a.speedKt || a.speedKt < 60) return null;
  if (inArrivalManoeuvre(a)) return null;
  const kmPerMin = (a.speedKt * 1.852) / 60;
  let best = { d: Infinity, m: 0 };
  for (let m = 0; m <= 8; m += 0.25) {
    const [la, lo] = destination(a.lat, a.lon, a.track, kmPerMin * m);
    const d = distanceKm(la, lo, home.lat, home.lon);
    if (d < best.d) best = { d, m };
  }
  return best.d <= 1.5 && best.m >= 0.5 ? { inMin: Math.round(best.m), closestKm: Math.round(best.d * 10) / 10 } : null;
}

/** Mode de pistes : direction des avions en finale (bas, en descente, alignés, près de l'aéroport). */
export function runwayMode(acs: Aircraft[]): Flights["runway"] {
  const votes: Record<string, number> = {};
  for (const a of acs) {
    if (a.onGround || a.altFt == null || a.altFt > 3500 || a.track == null || (a.vrate ?? 0) > -300) continue;
    if (distanceKm(a.lat, a.lon, YSSY.lat, YSSY.lon) > 25) continue;
    const t = a.track;
    const rwy = t >= 130 && t <= 190 ? "16" : t >= 310 || t <= 10 ? "34" : t >= 50 && t <= 100 ? "07" : t >= 230 && t <= 280 ? "25" : null;
    if (rwy) votes[rwy] = (votes[rwy] ?? 0) + 1;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const mode = best[0] === "16" || best[0] === "34" ? `Arrivals on runway ${best[0]}L/${best[0]}R` : `Arrivals on runway ${best[0]}`;
  return { mode, confidence: best[1] >= 2 ? "high" : "low" };
}

export function isCurfew(now: Date): boolean {
  const h = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(now));
  return h >= 23 || h < 6;
}

const airport = (a?: RawAirport): Airport | undefined =>
  a ? { iata: a.iata, icao: a.icao, name: a.name, location: a.location, ...(hasPos(a) ? { lat: a.lat, lon: a.lon } : {}) } : undefined;

export function normalize(raw: RawAc[], routes: Map<string, object>, trails: Map<string, [number, number][]>, now = Date.now(), history?: FlightHistory): Aircraft[] {
  return raw
    .filter((r) => r.lat != null && r.lon != null && (r.seen_pos ?? 0) < 60)
    .map((r) => {
      const cs = r.flight?.trim() || null;
      const route = cs ? (routes.get(cs) as RawRoute | undefined) : undefined;
      const onGround = r.alt_baro === "ground";
      const lat = r.lat!, lon = r.lon!;
      const speedKt = r.gs ?? null;
      const rare = r.t && RARE[r.t] !== undefined && RARE[r.t] !== "" ? RARE[r.t] : null;
      const military = ((r.dbFlags ?? 0) & 1) === 1;
      const okRoute = route && route.airport_codes !== "unknown" && route.plausible !== false && route.plausible !== 0 && route._airports?.length >= 2;
      const leg = okRoute && !onGround ? currentLeg(route._airports, lat, lon) : null;
      const year = Number(r.year);
      const ac: Aircraft = {
        hex: r.hex, callsign: cs, reg: r.r ?? null, type: r.t ?? null, desc: r.desc ?? null, category: r.category ?? null,
        operator: r.ownOp ?? null, built: Number.isInteger(year) && year > 1900 ? year : null,
        altFt: typeof r.alt_baro === "number" ? r.alt_baro : null, onGround, speedKt, track: r.track ?? null,
        vrate: r.baro_rate ?? r.geom_rate ?? null, lat, lon,
        posAt: Math.round(now - (r.seen_pos ?? 0) * 1000), source: sourceOf(r.type), squawk: r.squawk ?? null,
        distKm: Math.round(distanceKm(SITE.lat, SITE.lon, lat, lon) * 10) / 10,
        bearing: Math.round(bearingDeg(SITE.lat, SITE.lon, lat, lon)),
        military, interesting: military || ((r.dbFlags ?? 0) & 2) === 2 || rare != null,
        rare: rare ?? (military ? "Military" : null),
        emergency: emergencyOf(r),
        ...airlineOf(cs),
        route: okRoute
          ? { codes: route._airport_codes_iata ?? route.airport_codes, from: airport(leg?.from ?? route._airports[0]), to: airport(leg?.to ?? route._airports.at(-1)) }
          : null,
        progress: leg?.progress ?? null,
        overhead: onGround ? null : predictOverhead({ lat, lon, track: r.track ?? null, speedKt, altFt: typeof r.alt_baro === "number" ? r.alt_baro : null, vrate: r.baro_rate ?? r.geom_rate ?? null }),
        trail: history ? history.recent(r.hex, now) : trails.get(r.hex) ?? [],
        tookOffAt: history?.tookOffAt(r.hex) ?? null,
      };
      return ac;
    })
    .sort((a, b) => a.distKm - b.distKm);
}

/** Distance minimale (km) entre la maison et le segment parcouru entre deux positions (plan local). */
export function segmentMinKm(a: [number, number], b: [number, number], home = SITE): number {
  const kx = 111.32 * Math.cos((home.lat * Math.PI) / 180), ky = 110.57;
  const ax = (a[1] - home.lon) * kx, ay = (a[0] - home.lat) * ky, bx = (b[1] - home.lon) * kx, by = (b[0] - home.lat) * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Juge des annonces « overhead in N min » : chaque annonce est suivie sur la trace ADS-B réelle de l'avion
 * jusqu'à 3 minutes après l'heure prévue. Réussie si l'avion est passé à moins de 1,5 km de la maison.
 * Un avion perdu par le réseau avant l'heure prévue n'est pas compté (on ne sait pas).
 */
export class OverheadJudge {
  private pending = new Map<string, { at: number; inMin: number; due: number; minKm: number; last: [number, number]; seen: number; callsign: string | null }>();
  private recent = new Map<string, number>();
  announced = 0;
  hits = 0;
  readonly since: string;
  constructor(now = Date.now(), private hitKm = 1.5) { this.since = new Date(now).toISOString(); }

  update(acs: Aircraft[], now = Date.now()): OverheadOutcome[] {
    const out: OverheadOutcome[] = [];
    for (const a of acs) {
      if (a.onGround) continue;
      const p = this.pending.get(a.hex);
      if (p) {
        p.minKm = Math.min(p.minKm, segmentMinKm(p.last, [a.lat, a.lon]));
        p.last = [a.lat, a.lon];
        p.seen = now;
      } else if (a.overhead && a.overhead.inMin >= 1 && !(now - (this.recent.get(a.hex) ?? -Infinity) <= 20 * 60e3)) {
        this.pending.set(a.hex, { at: now, inMin: a.overhead.inMin, due: now + a.overhead.inMin * 60e3, minKm: a.distKm, last: [a.lat, a.lon], seen: now, callsign: a.callsign });
        this.recent.set(a.hex, now);
      }
    }
    for (const [hex, p] of this.pending) {
      const lost = now - p.seen > 60e3;
      if (now > p.due + 3 * 60e3 || lost) {
        this.pending.delete(hex);
        const resolved = p.minKm <= this.hitKm || p.seen >= p.due + 60e3;
        if (!resolved) continue; // perdu avant l'heure prévue : on ne sait pas
        const hit = p.minKm <= this.hitKm;
        this.announced++;
        if (hit) this.hits++;
        out.push({ hex, callsign: p.callsign, at: new Date(p.at).toISOString(), inMin: p.inMin, minKm: Math.round(p.minKm * 100) / 100, hit });
      }
    }
    for (const [hex, t] of this.recent) if (now - t > 60 * 60e3) this.recent.delete(hex);
    return out;
  }
}

/** État partagé : routes, historique des traces et recherche de routes. */
export interface FlightShared { routes: RouteCache; history: FlightHistory; lookup: (callsigns: string[], max?: number) => string[] }
export function flightShared(): FlightShared {
  const routes: RouteCache = new Map();
  return { routes, history: new FlightHistory(), lookup: routeLookup(routes) };
}

/** Rayon maximal d'une zone demandée par la carte (limite d'adsb.fi : 250 milles nautiques). */
export const AREA_MAX_NM = 250;
const AREA_TTL_MS = 8_000;

/**
 * Avions d'une zone quelconque, quand on déplace ou dézoome la carte loin de la maison.
 * Centre arrondi à 0,05° et rayon à 5 NM pour partager le cache entre écrans.
 */
export function areaFinder(shared: FlightShared, get = fetchFi) {
  const cache = new Map<string, { at: number; list: Promise<Aircraft[]> }>();
  return async (lat: number, lon: number, nm: number): Promise<Aircraft[]> => {
    const la = Math.round(lat * 20) / 20, lo = Math.round(lon * 20) / 20;
    const r = Math.min(AREA_MAX_NM, Math.max(5, Math.ceil(nm / 5) * 5));
    const key = `${la}|${lo}|${r}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < AREA_TTL_MS) return hit.list;
    for (const [k, v] of cache) if (Date.now() - v.at >= AREA_TTL_MS) cache.delete(k);
    const list = get(`https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${r}`).then((j) => {
      const raw = aircraftList(j);
      const now = Date.now();
      shared.history.add(raw, now);
      shared.lookup(raw.map((x) => x.flight?.trim() ?? ""), 3);
      return normalize(raw, shared.routes, new Map(), now, shared.history);
    });
    cache.set(key, { at: Date.now(), list });
    list.catch(() => cache.delete(key));
    return list;
  };
}

export function flightsCollector(shared: FlightShared = flightShared(), onOutcome: (o: OverheadOutcome) => void = () => {}): Collector<Flights> {
  const { routes, history, lookup } = shared;
  const judge = new OverheadJudge();
  const seen = new Map<string, string>(); // hex vu aujourd'hui (jour de Sydney)
  let lastFallback = 0;
  let lastWide = 0;
  return {
    id: "flights",
    everyMs: 10_000,
    staleAfterMs: 2 * 60e3,
    run: async ({ now }) => {
      let raw: RawAc[];
      let source = "adsb.fi";
      try {
        raw = aircraftList(await fetchFi(ADSB_FI));
      } catch (err) {
        if (now.getTime() - lastFallback < FALLBACK_EVERY_MS) throw err;
        lastFallback = now.getTime();
        raw = aircraftList(await fetchJson(ADSB_LOL));
        source = "adsb.lol";
      }
      history.add(raw, now.getTime());
      // Grand relevé pour les traces des vols de toute la région (jamais bloquant pour la maison).
      if (now.getTime() - lastWide >= WIDE_EVERY_MS) {
        lastWide = now.getTime();
        void fetchFi(`https://opendata.adsb.fi/api/v2/lat/${SITE.lat}/lon/${SITE.lon}/dist/${WIDE_NM}`)
          .then((j) => history.add(aircraftList(j), Date.now())).catch(() => {});
        history.prune(now.getTime());
      }
      // Routes des indicatifs inconnus (adsbdb), quelques-uns par relevé ; elles servent au relevé suivant.
      lookup(raw.filter((r) => r.lat != null).map((r) => r.flight?.trim() ?? ""), 5);
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(now);
      for (const [hex, d] of seen) if (d !== day) seen.delete(hex);
      const aircraft = normalize(raw, routes, new Map(), now.getTime(), history);
      for (const a of aircraft) if (a.distKm <= 10 && !a.onGround) seen.set(a.hex, day);
      for (const o of judge.update(aircraft, now.getTime())) onOutcome(o);
      return { aircraft, runway: runwayMode(aircraft), curfew: isCurfew(now), seenToday: seen.size, source, judged: { announced: judge.announced, hits: judge.hits, since: judge.since } };
    },
  };
}
