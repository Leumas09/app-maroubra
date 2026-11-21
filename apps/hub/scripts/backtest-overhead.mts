// Banc des annonces « overhead in N min » : rejoue un enregistrement réel d'adsb.lol (une ligne JSON par
// relevé, toutes les 10 s) et juge chaque façon de prévoir sur la trace réelle des avions.
// Précision : part des annonces confirmées à moins de 1,5 km. Rappel : part des survols réels
// (passage à moins de 1,5 km) annoncés au moins une minute avant.
// Usage : npx tsx scripts/backtest-overhead.mts <adsb.jsonl>
import { readFileSync } from "node:fs";
import type { Aircraft } from "@maroubra/core";
import { SITE } from "../src/config";
import { normalize, OverheadJudge, predictOverhead, predictOverheadTurning, segmentMinKm, type RawAc } from "../src/sources/flights";

const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const snaps = lines.flatMap((l) => { try { const j = JSON.parse(l); return [{ t: j.t * 1000 as number, ac: (j.r.ac ?? []) as RawAc[] }]; } catch { return []; } });
console.log(`${snaps.length} relevés, ${new Date(snaps[0].t).toISOString()} → ${new Date(snaps.at(-1)!.t).toISOString()}`);

type Predictor = (a: Aircraft) => Aircraft["overhead"];
const predictors: Record<string, Predictor> = {
  "ligne droite (actuel)": (a) => (a.onGround ? null : predictOverhead(a)),
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
      if (d <= 1.5) {
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
