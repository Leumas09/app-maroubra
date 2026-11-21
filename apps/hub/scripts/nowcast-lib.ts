// Banc seulement, pas en production (battue par la persistance, voir docs/PLAN.md partie I).
// Prévision immédiate par satellite : mouvement des nuages froids entre deux images Himawari
// (corrélation croisée), puis advection vers Maroubra. Évaluée par scripts/backtest-nowcast.mts.
import type { Grid } from "../src/sources/himawari";

export type { Grid };

/** Déplacement des nuages froids en pixels par intervalle d'images (est et nord positifs), ou nul si rien à suivre. */
export function motion(prev: Grid, cur: Grid, maxShift = 8, margin = 12): { dx: number; dy: number; score: number } {
  const n = cur.size;
  const cold = (t: number) => (Number.isFinite(t) ? Math.max(0, Math.min(60, 275 - t)) : 0);
  const a = new Float32Array(n * n), b = new Float32Array(n * n);
  let mass = 0;
  for (let i = 0; i < n * n; i++) { a[i] = cold(prev.tb[i]); b[i] = cold(cur.tb[i]); mass += b[i] > 0 ? 1 : 0; }
  if (mass < 200) return { dx: 0, dy: 0, score: 0 };
  let best = { dx: 0, dy: 0, score: -Infinity };
  for (let sy = -maxShift; sy <= maxShift; sy++) for (let sx = -maxShift; sx <= maxShift; sx++) {
    let num = 0, na = 0, nb = 0;
    for (let j = margin; j < n - margin; j += 2) for (let i = margin; i < n - margin; i += 2) {
      // Le nuage en (i, j) avant se trouve en (i + sx, j + sy) après.
      const va = a[j * n + i], vb = b[(j + sy) * n + (i + sx)];
      num += va * vb; na += va * va; nb += vb * vb;
    }
    const s = na && nb ? num / Math.sqrt(na * nb) : 0;
    if (s > best.score) best = { dx: sx, dy: sy, score: s };
  }
  return { dx: best.dx, dy: -best.dy, score: best.score };
}

/** Part des pixels plus froids que `thK` dans un disque de `rKm` autour d'un point (km depuis Maroubra). */
export function cloudFraction(g: Grid, thK: number, dxKm: number, dyKm: number, rKm: number): number {
  const r = Math.ceil(rKm / g.km);
  const ci = Math.floor(g.size / 2 + dxKm / g.km), cj = Math.floor(g.size / 2 - dyKm / g.km);
  let n = 0, c = 0;
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (i < 0 || j < 0 || i >= g.size || j >= g.size || (i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
    const t = g.tb[j * g.size + i];
    if (!Number.isFinite(t)) continue;
    n++;
    if (t < thK) c++;
  }
  return n ? c / n : NaN;
}
