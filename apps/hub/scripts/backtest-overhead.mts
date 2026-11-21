// Banc des annonces « overhead in N min » : rejoue un enregistrement réel d'adsb.lol (une ligne JSON par
// relevé, toutes les 10 s) et juge chaque façon de prévoir sur la trace réelle des avions.
// Précision : part des annonces confirmées à moins de 1,5 km. Rappel : part des survols réels
// (passage à moins de 1,5 km) annoncés au moins une minute avant.
// Usage : npx tsx scripts/backtest-overhead.mts <adsb.jsonl> [depuis ISO] (seuls les survols et annonces
// postérieurs sont jugés, pour évaluer une règle sur des données qui n'ont pas servi à l'établir).
import { readFileSync } from "node:fs";
import type { Aircraft } from "@maroubra/core";
import { SITE } from "../src/config";
import { bearingDeg, destination, distanceKm } from "../src/geo";
import { normalize, OverheadJudge, predictOverhead, segmentMinKm, type RawAc } from "../src/sources/flights";

const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const from = process.argv[3] ? Date.parse(process.argv[3]) : -Infinity;
const all = lines.flatMap((l) => { try { const j = JSON.parse(l); return [{ t: j.t * 1000 as number, ac: (j.r.ac ?? []) as RawAc[] }]; } catch { return []; } });
const snaps = all.filter((s) => s.t >= from - 15 * 60e3);
console.log(`${snaps.length} relevés, ${new Date(snaps[0].t).toISOString()} → ${new Date(snaps.at(-1)!.t).toISOString()}`);

/**
 * Survol prévu en tenant compte du virage en cours : le taux de virage est mesuré sur les dernières
 * positions de la trace (relevés toutes les 10 s), plafonné à 3,5 °/s, et le virage s'arrête après 120°
 * (un avion qui tourne vers la finale finit par s'aligner). Sans virage net, c'est la ligne droite.
 * Essayé le 21/11/2026 et écarté : moins précis que la ligne droite (bench/results/overhead_adsb_20261121.txt).
 */
function predictOverheadTurning(a: { lat: number; lon: number; track: number | null; speedKt: number | null; trail: [number, number][] }, home = SITE, pollS = 10): Aircraft["overhead"] {
  if (a.track == null || !a.speedKt || a.speedKt < 60) return null;
  const tr = a.trail;
  let rate = 0;
  if (tr.length >= 5) {
    const p = tr.slice(-5);
    const h1 = bearingDeg(p[0][0], p[0][1], p[2][0], p[2][1]), h2 = bearingDeg(p[2][0], p[2][1], p[4][0], p[4][1]);
    const moved = distanceKm(p[0][0], p[0][1], p[4][0], p[4][1]);
    const turn = ((h2 - h1 + 540) % 360) - 180;
    if (moved > 0.3) rate = Math.max(-3.5, Math.min(3.5, turn / (2 * pollS)));
    if (Math.abs(rate) < 0.4) rate = 0;
  }
  if (!rate) return predictOverhead(a, home);
  const kmPerS = (a.speedKt * 1.852) / 3600;
  let lat = a.lat, lon = a.lon, hdg = a.track, turned = 0;
  let best = { d: distanceKm(lat, lon, home.lat, home.lon), m: 0 };
  const step = 5;
  for (let t = step; t <= 8 * 60; t += step) {
    if (Math.abs(turned) < 120) { hdg = (hdg + rate * step + 360) % 360; turned += rate * step; }
    const prev: [number, number] = [lat, lon];
    [lat, lon] = destination(lat, lon, hdg, kmPerS * step);
    const d = segmentMinKm(prev, [lat, lon], home);
    if (d < best.d) best = { d, m: t / 60 };
  }
  return best.d <= 1.5 && best.m >= 0.5 ? { inMin: Math.round(best.m), closestKm: Math.round(best.d * 10) / 10 } : null;
}

type Predictor = (a: Aircraft) => Aircraft["overhead"];
const predictors: Record<string, Predictor> = {
  "ligne droite (avant)": (a) => (a.onGround ? null : predictOverhead({ lat: a.lat, lon: a.lon, track: a.track, speedKt: a.speedKt })),
  "ligne droite sans arrivées": (a) => (a.onGround ? null : predictOverhead(a)),
  "virage mesuré sur la trace": (a) => (a.onGround ? null : predictOverheadTurning(a)),
};

// Survols réels : passage à moins de 1,5 km, d'après les traces.
const truth = new Map<string, { t: number; minKm: number }[]>();
{
  const last = new Map<string, { t: number; p: [number, number] }>();
  for (const s of snaps) for (const r of s.ac) {
    if (r.lat == null || r.lon == null || r.alt_baro === "ground" || (r.seen_pos ?? 0) > 20) continue;
    const prev = last.get(r.hex);
    if (prev && s.t - prev.t < 60e3) {
      const d = segmentMinKm(prev.p, [r.lat, r.lon], SITE);
      if (d <= 1.5 && s.t >= from) {
        const list = truth.get(r.hex) ?? [];
        if (!list.length || s.t - list.at(-1)!.t > 20 * 60e3) list.push({ t: s.t, minKm: d });
        truth.set(r.hex, list);
      }
    }
    last.set(r.hex, { t: s.t, p: [r.lat, r.lon] });
  }
}
const passes = [...truth.values()].flat().length;
console.log(`${passes} survols réels à moins de 1,5 km`);

for (const [name, pred] of Object.entries(predictors)) {
  const judge = new OverheadJudge(snaps[0].t);
  const trails = new Map<string, [number, number][]>();
  const announcedAt = new Map<string, number[]>();
  let outcomes = 0;
  for (const s of snaps) {
    for (const r of s.ac) {
      if (r.lat == null || r.lon == null) continue;
      const tr = trails.get(r.hex) ?? [];
      const p: [number, number] = [Math.round(r.lat * 1e4) / 1e4, Math.round(r.lon * 1e4) / 1e4];
      if (tr.length && tr.at(-1)![0] === p[0] && tr.at(-1)![1] === p[1]) continue;
      tr.push(p);
      trails.set(r.hex, tr.slice(-60));
    }
    const acs = normalize(s.ac, new Map(), trails).map((a) => ({ ...a, overhead: pred(a) }));
    if (s.t < from) { for (const a of acs) a.overhead = null; }
    for (const a of acs) if (a.overhead && a.overhead.inMin >= 1) announcedAt.set(a.hex, [...(announcedAt.get(a.hex) ?? []), s.t]);
    outcomes += judge.update(acs, s.t).length;
  }
  judge.update([], snaps.at(-1)!.t + 10 * 60e3);
  // Rappel : un survol réel est « annoncé » si une annonce a précédé le passage d'au moins 1 min, et de 9 min au plus.
  let caught = 0;
  for (const [hex, list] of truth) for (const p of list) if ((announcedAt.get(hex) ?? []).some((t) => t <= p.t - 60e3 && t >= p.t - 9 * 60e3)) caught++;
  const prec = judge.announced ? judge.hits / judge.announced : NaN;
  console.log(`${name.padEnd(28)} annonces ${String(judge.announced).padStart(3)}, confirmées ${String(judge.hits).padStart(3)} (${(prec * 100).toFixed(0)} %), survols annoncés ${caught}/${passes} (${((caught / Math.max(1, passes)) * 100).toFixed(0)} %)`);
  void outcomes;
}
