// Banc : les étages de nuages déduits de l'infrarouge seul (bande 13) contre les couches du METAR de YSSY.
// Usage : npx tsx scripts/check-ir-layers.mts (chemins des grilles et des METAR à adapter en tête de fichier).
import { existsSync, readFileSync } from "node:fs";
import { localRef, clearRef, type Grid } from "../src/sources/himawari";
const dir = "/tmp/claude-0/-home-user-app-maroubra/4c75192b-a37c-523c-a292-7dc6360ff3b0/scratchpad/grids";
const metars = JSON.parse(readFileSync("/tmp/claude-0/-home-user-app-maroubra/4c75192b-a37c-523c-a292-7dc6360ff3b0/scratchpad/metar-7d.json", "utf8")) as { obsTime: number; rawOb: string }[];
const COV: Record<string, number> = { FEW: 0.19, SCT: 0.44, BKN: 0.75, OVC: 1 };
// Couverture par étage d'après le METAR (bases en centaines de pieds) : bas < 6500 ft, moyen 6500 à 20000, haut au-delà.
function layers(raw: string) {
  const body = raw.split(" RMK")[0];
  const out = { low: 0, mid: 0, high: 0, clear: /CAVOK|NCD|NSC|SKC|CLR/.test(body) };
  for (const m of body.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})/g)) {
    const ft = +m[2] * 100, c = COV[m[1]];
    if (ft < 6500) out.low = Math.max(out.low, c); else if (ft < 20000) out.mid = Math.max(out.mid, c); else out.high = Math.max(out.high, c);
  }
  return out;
}
type V = (t: number, ref: number) => "low" | "mid" | "high";
const variants: Record<string, V> = {
  "seuils fixes 263/233 K": (t) => (t < 233 ? "high" : t < 263 ? "mid" : "low"),
  "hauteur 2 et 6 km (6,5 K/km)": (t, r) => (t < r - 39 ? "high" : t < r - 13 ? "mid" : "low"),
};
const res: Record<string, { lowPairs: [number, number][]; midHigh: [number, number][] }> = {};
for (const name of Object.keys(variants)) res[name] = { lowPairs: [], midHigh: [] };
for (const m of metars) {
  const t = Math.round(m.obsTime / 600) * 600 * 1000;
  const p = `${dir}/${new Date(t).toISOString().slice(0, 16).replace(/[-:]/g, "")}.u16`;
  if (!existsSync(p)) continue;
  const L = layers(m.rawOb);
  const u = new Uint16Array(readFileSync(p).buffer.slice(0)); const tb = new Float32Array(u.length); for (let i = 0; i < u.length; i++) tb[i] = u[i] ? u[i] / 100 : NaN;
  const g: Grid = { size: 200, km: 1.5, tb }; const ref = localRef(g, clearRef(g));
  // Disque de 8 km autour de l'aéroport (7,5 km à l'ouest de Maroubra).
  const ci = Math.floor(100 - 7.5 / 1.5), cj = 100, r = Math.ceil(8 / 1.5);
  for (const [name, v] of Object.entries(variants)) {
    let n = 0, low = 0, upper = 0;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if ((i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
      const x = g.tb[j * 200 + i]; if (!Number.isFinite(x)) continue; n++;
      if (x > ref[j * 200 + i] - 4) continue;
      const c = v(x, ref[j * 200 + i]); if (c === "low") low++; else upper++;
    }
    res[name].lowPairs.push([L.low, low / n]);
    res[name].midHigh.push([Math.max(L.mid, L.high), upper / n]);
  }
}
const corr = (p: [number, number][]) => { const n = p.length, mx = p.reduce((a, x) => a + x[0], 0) / n, my = p.reduce((a, x) => a + x[1], 0) / n; let sxy = 0, sx = 0, sy = 0; for (const [x, y] of p) { sxy += (x - mx) * (y - my); sx += (x - mx) ** 2; sy += (y - my) ** 2; } return sxy / Math.sqrt(sx * sy); };
const mae = (p: [number, number][]) => p.reduce((a, [x, y]) => a + Math.abs(x - y), 0) / p.length;
for (const [name, r] of Object.entries(res)) console.log(`${name.padEnd(30)} bas: r=${corr(r.lowPairs).toFixed(2)} MAE=${mae(r.lowPairs).toFixed(2)} | moyen+haut: r=${corr(r.midHigh).toFixed(2)} MAE=${mae(r.midHigh).toFixed(2)} (n=${r.lowPairs.length})`);
