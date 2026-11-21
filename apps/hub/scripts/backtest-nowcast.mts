// Banc : la pluie dans l'heure à l'aéroport de Sydney peut-elle se prévoir avec l'image satellite seule
// (nuages épais et froids, déplacés selon leur mouvement mesuré entre deux images) ? Juge : METAR de YSSY.
// Référence à battre : la persistance (« il pleut maintenant, il pleuvra dans 30 min »).
// Usage : npx tsx scripts/backtest-nowcast.mts <dossier des grilles> <metar.json>
import { existsSync, readFileSync } from "node:fs";
import { metarRain } from "../src/sources/weather";
import { cloudFraction, motion, type Grid } from "./nowcast-lib";

const [dir, metarPath] = process.argv.slice(2);
const SIZE = 200, KM = 1.5;
const load = (t: number): Grid | null => {
  const iso = new Date(t).toISOString();
  const p = `${dir}/${iso.slice(0, 16).replace(/[-:]/g, "")}.u16`;
  if (!existsSync(p)) return null;
  const u = new Uint16Array(readFileSync(p).buffer.slice(0));
  const tb = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) tb[i] = u[i] ? u[i] / 100 : NaN;
  return { size: SIZE, km: KM, tb };
};

// Pluie présente (pas « récente ») dans chaque METAR ou SPECI.
const metars = (JSON.parse(readFileSync(metarPath, "utf8")) as { obsTime: number; rawOb: string }[])
  .map((m) => ({ t: m.obsTime * 1000, rain: metarRain(m.rawOb.replace(/\sRE[A-Z]+/g, "")) }))
  .sort((a, b) => a.t - b.t);
const first = metars[0].t, last = metars.at(-1)!.t;
const rainIn = (a: number, b: number) => metars.some((m) => m.t > a && m.t <= b && m.rain);
const rainNow = (t: number) => { const m = [...metars].reverse().find((x) => x.t <= t && x.t > t - 35 * 60e3); return m ? m.rain : null; };

// YSSY par rapport à Maroubra (centre de la grille) : 7,5 km à l'ouest.
const AIRPORT = { dx: -7.5, dy: 0.4 };

type Row = { t: number; obs: boolean; persist: boolean; sat: Record<string, number>; satStill: Record<string, number> };
const LEADS = [30, 60];
const THRESH = [245, 255, 265];

for (const lead of LEADS) {
  const rows: Row[] = [];
  for (let t = Math.ceil(first / 600e3) * 600e3; t + lead * 60e3 <= last; t += 10 * 60e3) {
    const cur = load(t), prev = load(t - 10 * 60e3);
    const now = rainNow(t);
    if (!cur || now == null) continue;
    const mv = prev ? motion(prev, cur) : { dx: 0, dy: 0 };
    const steps = lead / 10;
    const sat: Record<string, number> = {}, satStill: Record<string, number> = {};
    for (const th of THRESH) {
      // Advection : ce qui sera au-dessus de l'aéroport dans `lead` minutes est aujourd'hui en amont.
      sat[th] = cloudFraction(cur, th, AIRPORT.dx - mv.dx * steps * KM, AIRPORT.dy - mv.dy * steps * KM, 10);
      satStill[th] = cloudFraction(cur, th, AIRPORT.dx, AIRPORT.dy, 10);
    }
    rows.push({ t, obs: rainIn(t + (lead - 15) * 60e3, t + (lead + 15) * 60e3), persist: now, sat, satStill });
  }
  const score = (pred: (r: Row) => boolean) => {
    let h = 0, f = 0, m = 0, c = 0;
    for (const r of rows) { const p = pred(r); if (p && r.obs) h++; else if (p) f++; else if (r.obs) m++; else c++; }
    return { csi: h / Math.max(1, h + f + m), hits: h, falseAlarms: f, misses: m, pod: h / Math.max(1, h + m), far: f / Math.max(1, h + f) };
  };
  const fmt = (s: ReturnType<typeof score>) => `CSI ${s.csi.toFixed(3)}  POD ${s.pod.toFixed(2)}  FAR ${s.far.toFixed(2)}  (${s.hits} hits, ${s.falseAlarms} false, ${s.misses} missed)`;
  console.log(`\n== ${lead} min ahead, ${rows.length} cases, ${rows.filter((r) => r.obs).length} with rain`);
  console.log(`persistence                   ${fmt(score((r) => r.persist))}`);
  for (const th of THRESH) for (const frac of [0.2, 0.4, 0.6]) {
    console.log(`satellite <${th} K ≥${frac} moved  ${fmt(score((r) => r.sat[th] >= frac))}`);
    console.log(`satellite <${th} K ≥${frac} still  ${fmt(score((r) => r.satStill[th] >= frac))}`);
  }
  console.log(`persistence OR moved <255 ≥0.4 ${fmt(score((r) => r.persist || r.sat[255] >= 0.4))}`);
}
