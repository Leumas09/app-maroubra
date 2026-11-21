// « Ce soir, le meilleur à voir » : ce que le ciel de Maroubra offre entre la tombée de la nuit et l'aube,
// avec l'heure, la direction et un score de visibilité qui tient compte des nuages prévus par couche,
// de la Lune (pour ce qui est pâle) et de la hauteur dans le ciel.
// Les positions viennent de @maroubra/sky (vérifié contre Skyfield) ; le score est expérimental, à vérifier
// contre les nuages réels (Himawari) et les votes « Saw it? » (palier suivant du plan Sky).
import type { Iss, WeatherHour } from "@maroubra/core";
import { astronomy as A, horizontal, MAROUBRA, moonIllumination, starsHorizontal, sunAltitudeCrossing, type Body } from "@maroubra/sky";
import type { SkyModel } from "./sky-model";

export interface SkyEvent {
  key: string;
  kind: "iss" | "planet" | "milkyway" | "meteors" | "moon" | "conjunction" | "eclipse";
  title: string;
  detail: string;
  at: Date;
  until?: Date;
  /** Direction (azimut) et hauteur au meilleur moment. */
  az: number;
  alt: number;
  /** Pâle : gêné par la Lune (Voie lactée, étoiles filantes). */
  faint: boolean;
  /** Score de visibilité 0 à 10, null si les nuages ne sont pas connus. */
  score: number | null;
  why: string;
}

/** Essaims d'étoiles filantes : liste de travail de l'IMO (dates de pic approchées, taux horaire zénithal, radiant J2000). */
export const SHOWERS: { name: string; month: number; day: number; spread: number; zhr: number; ra: number; dec: number }[] = [
  { name: "Quadrantids", month: 1, day: 3, spread: 3, zhr: 80, ra: 230, dec: 49 },
  { name: "Alpha Centaurids", month: 2, day: 8, spread: 6, zhr: 6, ra: 210, dec: -59 },
  { name: "Lyrids", month: 4, day: 22, spread: 4, zhr: 18, ra: 271, dec: 34 },
  { name: "Eta Aquariids", month: 5, day: 6, spread: 10, zhr: 50, ra: 338, dec: -1 },
  { name: "Southern Delta Aquariids", month: 7, day: 30, spread: 12, zhr: 25, ra: 340, dec: -16 },
  { name: "Alpha Capricornids", month: 7, day: 30, spread: 12, zhr: 5, ra: 307, dec: -10 },
  { name: "Perseids", month: 8, day: 12, spread: 10, zhr: 100, ra: 48, dec: 58 },
  { name: "Southern Taurids", month: 10, day: 10, spread: 15, zhr: 5, ra: 32, dec: 9 },
  { name: "Orionids", month: 10, day: 21, spread: 7, zhr: 20, ra: 95, dec: 16 },
  { name: "Northern Taurids", month: 11, day: 12, spread: 12, zhr: 5, ra: 58, dec: 22 },
  { name: "Leonids", month: 11, day: 17, spread: 4, zhr: 15, ra: 152, dec: 22 },
  { name: "Puppid-Velids", month: 12, day: 7, spread: 5, zhr: 10, ra: 123, dec: -45 },
  { name: "Geminids", month: 12, day: 14, spread: 4, zhr: 150, ra: 112, dec: 33 },
  { name: "Ursids", month: 12, day: 22, spread: 2, zhr: 10, ra: 217, dec: 76 },
];

/** Centre galactique (cœur de la Voie lactée), J2000. */
const GALACTIC_CENTRE = { ra: 266.4, dec: -29.0 };

const hm = (d: Date) => new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(d);
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const dir = (az: number) => COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];

/** Nuit à considérer : de la nuit noire (Soleil sous −12°) jusqu'à l'aube suivante. */
export function nightWindow(now: Date): { start: Date; end: Date } {
  const sunAlt = horizontal(A.Body.Sun, now).alt;
  const start = sunAlt < -12 ? now : sunAltitudeCrossing(-12, -1, now) ?? now;
  const end = sunAltitudeCrossing(-12, +1, start) ?? new Date(start.getTime() + 10 * 3600e3);
  return { start, end };
}

function samples(from: Date, to: Date, stepMin = 10): Date[] {
  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += stepMin * 60e3) out.push(new Date(t));
  return out;
}

/** Score de visibilité à l'instant t : ciel dégagé × Lune (si pâle) × hauteur. */
export function visibility(t: Date, alt: number, faint: boolean, hours: WeatherHour[] | null): { score: number | null; why: string } {
  const h = hours?.length ? hours.reduce((best, x) => (Math.abs(x.t * 1000 - t.getTime()) < Math.abs(best.t * 1000 - t.getTime()) ? x : best)) : null;
  const near = h && Math.abs(h.t * 1000 - t.getTime()) <= 90 * 60e3 ? h : null;
  const parts: string[] = [];
  let f = alt < 10 ? 0.5 : alt < 20 ? 0.8 : 1;
  if (alt < 10) parts.push("low on the horizon");
  if (faint) {
    const moonUp = horizontal(A.Body.Moon, t).alt > 0;
    const illum = moonIllumination(t);
    if (moonUp && illum > 0.25) { f *= 1 - illum * 0.8; parts.push(`${Math.round(illum * 100)}% Moon up`); }
    else parts.push("no moonlight");
  }
  if (!near) return { score: null, why: [...parts, "clouds unknown"].join(", ") };
  // Les nuages bas cachent tout ; les voiles d'altitude laissent passer le brillant.
  const cover = Math.max(near.cloudLow, near.cloudMid * 0.85, near.cloudHigh * (faint ? 0.7 : 0.4));
  f *= 1 - cover / 100;
  if (near.precip > 0.2) f *= 0.3;
  parts.unshift(cover < 20 ? "clear sky forecast" : cover < 50 ? `${Math.round(cover)}% cloud forecast` : `mostly cloudy (${Math.round(cover)}%)`);
  return { score: Math.round(f * 100) / 10, why: parts.join(", ") };
}

export function skyEvents(now: Date, sky: SkyModel, iss: Iss | null, hours: WeatherHour[] | null): SkyEvent[] {
  const { start, end } = nightWindow(now);
  const dark = samples(start, end, 10);
  const out: SkyEvent[] = [];
  const push = (e: Omit<SkyEvent, "score" | "why">) => out.push({ ...e, ...visibility(e.at, e.alt, e.faint, hours) });

  // Station spatiale : passages visibles assez hauts pendant la nuit.
  for (const p of iss?.passes ?? []) {
    const t = new Date(p.max);
    if (t < now || t > end || p.maxAlt < 20) continue;
    push({ key: `iss-${p.start}`, kind: "iss", title: "Space Station passes over", detail: `A bright, steady moving star from the ${dir(p.startAz)} to the ${dir(p.endAz)}, ${p.durationMin} min, up to ${p.maxAlt}° high`, at: new Date(p.start), until: new Date(p.end), az: p.startAz, alt: p.maxAlt, faint: false });
  }

  // Planètes : leur meilleur moment de la nuit (le plus haut).
  for (const name of ["Venus", "Jupiter", "Mars", "Saturn", "Mercury"] as Body[]) {
    let best: { t: Date; alt: number; az: number } | null = null;
    for (const t of dark) {
      const h = horizontal(name, t);
      if (h.alt > 10 && (!best || h.alt > best.alt)) best = { t, alt: h.alt, az: h.az };
    }
    if (!best) continue;
    const mag = A.Illumination(name, best.t).mag;
    if (mag > 2) continue;
    push({ key: `planet-${name}`, kind: "planet", title: `${name} at its highest`, detail: `Magnitude ${mag.toFixed(1)}${mag < -1 ? ", brighter than any star" : ""}`, at: best.t, az: best.az, alt: best.alt, faint: false });
  }

  // Rapprochements : deux planètes, ou la Lune et une planète, à moins de 4° l'une de l'autre.
  const mid = dark[Math.floor(dark.length / 3)] ?? start;
  const bodies = (["Moon", "Venus", "Jupiter", "Mars", "Saturn"] as Body[]).map((b) => ({ b, h: horizontal(b, mid) })).filter((x) => x.h.alt > 10);
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j];
    const r = Math.PI / 180;
    const sep = Math.acos(Math.sin(a.h.alt * r) * Math.sin(b.h.alt * r) + Math.cos(a.h.alt * r) * Math.cos(b.h.alt * r) * Math.cos((a.h.az - b.h.az) * r)) / r;
    if (sep < 4) push({ key: `conj-${a.b}-${b.b}`, kind: "conjunction", title: `${a.b} and ${b.b} side by side`, detail: `${sep.toFixed(1)}° apart, a pretty pair to the eye or in binoculars`, at: mid, az: a.h.az, alt: a.h.alt, faint: false });
  }

  // Cœur de la Voie lactée : nuit astronomique et assez haut.
  const core = dark.map((t) => ({ t, h: starsHorizontal([GALACTIC_CENTRE], t)[0], sun: horizontal(A.Body.Sun, t).alt })).filter((x) => x.sun < -18 && x.h.alt > 15);
  if (core.length) {
    const best = core.reduce((m, x) => (x.h.alt > m.h.alt ? x : m));
    push({ key: "milkyway", kind: "milkyway", title: "Core of the Milky Way", detail: `Visible from ${hm(core[0].t)}; find a spot away from street lights and give your eyes 20 minutes`, at: best.t, until: core.at(-1)!.t, az: best.h.az, alt: best.h.alt, faint: true });
  }

  // Étoiles filantes : essaims actifs, taux attendu au meilleur moment (radiant le plus haut).
  for (const s of SHOWERS) {
    const peak = Date.UTC(now.getUTCFullYear(), s.month - 1, s.day);
    const days = [peak - 365 * 864e5, peak, peak + 365 * 864e5].map((p) => (start.getTime() - p) / 864e5).reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
    if (Math.abs(days) > s.spread) continue;
    const rad = dark.map((t) => ({ t, h: starsHorizontal([s], t)[0] })).reduce((m, x) => (x.h.alt > m.h.alt ? x : m), { t: start, h: { alt: -90, az: 0 } });
    if (rad.h.alt < 10) continue;
    const activity = Math.exp(-((days / (s.spread / 2)) ** 2)); // décroît loin du pic
    const rate = Math.round(s.zhr * activity * Math.sin((rad.h.alt * Math.PI) / 180) * 0.4); // ciel de ville : environ 40 % du taux zénithal
    if (rate < 2) continue;
    push({ key: `meteors-${s.name}`, kind: "meteors", title: `${s.name} meteor shower`, detail: `${Math.abs(days) < 1 ? "Peak tonight" : days < 0 ? `Peak in ${Math.round(-days)} day${Math.round(-days) > 1 ? "s" : ""}` : `${Math.round(days)} day${Math.round(days) > 1 ? "s" : ""} after the peak`}, about ${rate} an hour from town; the radiant is where to look`, at: rad.t, az: rad.h.az, alt: rad.h.alt, faint: true });
  }

  // Lever de Lune sur la mer, déjà calculé.
  const m = sky.moonriseOverSeaNext[0];
  if (m && m.time >= now && m.time.getTime() - now.getTime() < 20 * 3600e3) {
    push({ key: `moonrise-${m.time.toISOString()}`, kind: "moon", title: "Moonrise over the sea", detail: `${Math.round(m.illumination * 100)}% lit, a path of light on the water`, at: m.time, az: m.azimuth, alt: 1, faint: false });
  }

  // Éclipses dans les deux semaines.
  const le = A.SearchLunarEclipse(now);
  if (le.peak.date.getTime() - now.getTime() < 14 * 864e5) {
    const h = horizontal(A.Body.Moon, le.peak.date);
    if (h.alt > 0) push({ key: `lunar-${le.peak.date.toISOString()}`, kind: "eclipse", title: `${le.kind[0].toUpperCase()}${le.kind.slice(1)} lunar eclipse`, detail: `Peak at ${hm(le.peak.date)}`, at: le.peak.date, az: h.az, alt: h.alt, faint: false });
  }
  const se = A.SearchLocalSolarEclipse(now, new A.Observer(MAROUBRA.lat, MAROUBRA.lon, 0));
  if (se.peak.time.date.getTime() - now.getTime() < 14 * 864e5 && se.peak.altitude > 0) {
    const h = horizontal(A.Body.Sun, se.peak.time.date);
    push({ key: `solar-${se.peak.time.date.toISOString()}`, kind: "eclipse", title: `${se.kind[0].toUpperCase()}${se.kind.slice(1)} solar eclipse`, detail: `Peak at ${hm(se.peak.time.date)}. Never look at the Sun without eclipse glasses`, at: se.peak.time.date, az: h.az, alt: h.alt, faint: false });
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}
