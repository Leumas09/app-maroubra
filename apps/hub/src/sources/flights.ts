// Avions autour de Maroubra : positions ADS-B d'adsb.lol (API v2, sans clé) et routes de son
// service « routeset ». On déduit le mode de pistes de Sydney, le couvre-feu et les survols imminents.
import type { Aircraft, Airport, Flights } from "@maroubra/core";
import { airlineOf } from "./airlines";
import { SITE } from "../config";
import { bearingDeg, destination, distanceKm } from "../geo";
import { fetchJson } from "../http";
import type { Collector } from "../collector";

const YSSY = { lat: -33.9461, lon: 151.1772 };
const RADIUS_NM = 25;

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

/** Survol prévu : on prolonge la trajectoire en ligne droite 8 minutes et on cherche le passage le plus proche. */
export function predictOverhead(a: { lat: number; lon: number; track: number | null; speedKt: number | null }, home = SITE): Aircraft["overhead"] {
  if (a.track == null || !a.speedKt || a.speedKt < 60) return null;
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

export function normalize(raw: RawAc[], routes: Map<string, RawRoute>, trails: Map<string, [number, number][]>, now = Date.now()): Aircraft[] {
  return raw
    .filter((r) => r.lat != null && r.lon != null && (r.seen_pos ?? 0) < 60)
    .map((r) => {
      const cs = r.flight?.trim() || null;
      const route = cs ? routes.get(cs) : undefined;
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
        overhead: onGround ? null : predictOverhead({ lat, lon, track: r.track ?? null, speedKt }),
        trail: trails.get(r.hex) ?? [],
      };
      return ac;
    })
    .sort((a, b) => a.distKm - b.distKm);
}

export function flightsCollector(): Collector<Flights> {
  const routes = new Map<string, RawRoute & { at: number }>();
  const trails = new Map<string, [number, number][]>();
  const seen = new Map<string, string>(); // hex vu aujourd'hui (jour de Sydney)
  return {
    id: "flights",
    everyMs: 10_000,
    staleAfterMs: 2 * 60e3,
    run: async ({ now }) => {
      const j = await fetchJson<{ ac?: RawAc[] }>(`https://api.adsb.lol/v2/point/${SITE.lat}/${SITE.lon}/${RADIUS_NM}`);
      const raw = j.ac ?? [];
      // Traces des 10 dernières minutes (1 point par passage)
      for (const r of raw) {
        if (r.lat == null || r.lon == null) continue;
        const t = trails.get(r.hex) ?? [];
        t.push([Math.round(r.lat * 1e4) / 1e4, Math.round(r.lon * 1e4) / 1e4]);
        trails.set(r.hex, t.slice(-60));
      }
      for (const hex of trails.keys()) if (!raw.some((r) => r.hex === hex)) trails.delete(hex);
      // Routes des indicatifs inconnus, par lots, gardées 6 h
      const missing = raw.filter((r) => r.flight?.trim() && r.lat != null && (!routes.has(r.flight.trim()) || now.getTime() - routes.get(r.flight.trim())!.at > 6 * 3600e3));
      if (missing.length) {
        try {
          const res = await fetchJson<RawRoute[]>("https://api.adsb.lol/api/0/routeset", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planes: missing.slice(0, 100).map((r) => ({ callsign: r.flight!.trim(), lat: r.lat, lng: r.lon })) }),
          });
          for (const r of res) routes.set(r.callsign, { ...r, at: now.getTime() });
        } catch { /* les routes sont un plus : on continue sans */ }
      }
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(now);
      for (const [hex, d] of seen) if (d !== day) seen.delete(hex);
      const aircraft = normalize(raw, routes, trails, now.getTime());
      for (const a of aircraft) if (a.distKm <= 10 && !a.onGround) seen.set(a.hex, day);
      return { aircraft, runway: runwayMode(aircraft), curfew: isCurfew(now), seenToday: seen.size };
    },
  };
}
