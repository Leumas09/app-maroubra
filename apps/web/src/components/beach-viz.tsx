// Instruments de la plage : cadran du score, rose des vents posée sur la plage, échelles d'eau et d'UV,
// ruban horaire (score, vent, houle, marée, UV sur le même axe) et barres des facteurs.
import type { Beach, BeachReason, SwimHour } from "@maroubra/core";
import { compass, time } from "../lib/format";
import { curve, type TideTable } from "../lib/tide";

export const scoreColor = (s: number) => (s >= 8 ? "var(--good)" : s >= 6.5 ? "var(--accent)" : s >= 5 ? "var(--sun)" : "var(--alert)");
const sideColor = (side: SwimHour["side"]) => (side === "offshore" ? "var(--good)" : side === "onshore" ? "var(--alert)" : "var(--muted)");
const rad = (d: number) => (d * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, az: number) => [cx + r * Math.sin(rad(az)), cy - r * Math.cos(rad(az))] as const;

/** Cadran en demi-cercle de 0 à 10, aiguille sur le score du moment, repère sur le meilleur créneau. */
export function ScoreDial({ score, best, label, dim }: { score: number; best: number | null; label: string; dim?: boolean }) {
  const W = 240, cx = 120, cy = 122, r = 96;
  const az = (s: number) => -90 + (Math.max(0, Math.min(10, s)) / 10) * 180;
  const arc = (a: number, b: number) => {
    const [x1, y1] = pt(cx, cy, r, az(a));
    const [x2, y2] = pt(cx, cy, r, az(b));
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  };
  const bands: [number, number, string][] = [[0, 3, "var(--alert)"], [3, 5, "var(--alert)"], [5, 6.5, "var(--sun)"], [6.5, 8, "var(--accent)"], [8, 10, "var(--good)"]];
  const [nx, ny] = pt(cx, cy, r - 26, az(score));
  return (
    <svg viewBox={`-28 -14 ${W + 56} 150`} className="dial" role="img" aria-label={`Swim score ${score.toFixed(1)} out of 10, ${label}`}>
      <path d={arc(0, 10)} fill="none" stroke="var(--slot)" strokeWidth="18" strokeLinecap="round" />
      {bands.map(([a, b, c]) => <path key={a} d={arc(a + 0.06, b - 0.06)} fill="none" stroke={c} strokeOpacity="0.22" strokeWidth="10" />)}
      {!dim && <path d={arc(0, Math.max(0.05, score))} fill="none" stroke={scoreColor(score)} strokeWidth="10" strokeLinecap="round" />}
      {[0, 2, 4, 6, 8, 10].map((s) => {
        const [x1, y1] = pt(cx, cy, r + 13, az(s));
        const [x2, y2] = pt(cx, cy, r + 20, az(s));
        const [tx, ty] = pt(cx, cy, r + 31, az(s));
        return <g key={s}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted)" strokeWidth="1.5" /><text x={tx} y={ty + 4} textAnchor="middle" fontSize="11" fill="var(--muted)">{s}</text></g>;
      })}
      {best != null && (() => {
        const [x1, y1] = pt(cx, cy, r - 12, az(best));
        const [x2, y2] = pt(cx, cy, r + 12, az(best));
        return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round"><title>Best window {best}</title></line>;
      })()}
      {!dim && <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />}
      {!dim && <circle cx={cx} cy={cy} r="7" fill="var(--ink)" />}
    </svg>
  );
}

/**
 * Rose posée sur la plage : la mer à l'est (côté de la normale à la plage), la terre à l'ouest, le trait de côte entre les deux.
 * Vent : la flèche part du point d'où il vient et file vers où il souffle. Houle : la flèche arrive du large vers la plage.
 */
export function BeachCompass({ fromDeg, facing, kind, color, size = 190 }: { fromDeg: number; facing: number; kind: "wind" | "swell"; color: string; size?: number }) {
  const c = 100, r = 78;
  const [s1x, s1y] = pt(c, c, r, facing - 90);
  const [s2x, s2y] = pt(c, c, r, facing + 90);
  const [ax, ay] = pt(c, c, r - 6, fromDeg);
  const [bx, by] = pt(c, c, r - 18, fromDeg + 180);
  const head = (x: number, y: number, dir: number) => {
    const [lx, ly] = pt(x, y, 14, dir + 180 - 28);
    const [rx, ry] = pt(x, y, 14, dir + 180 + 28);
    return `M${x},${y} L${lx},${ly} L${rx},${ry} Z`;
  };
  const toward = (fromDeg + 180) % 360;
  const [seaX, seaY] = pt(c, c, r * 0.55, facing);
  const [landX, landY] = pt(c, c, r * 0.55, facing + 180);
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="compass" role="img"
      aria-label={`${kind === "wind" ? "Wind" : "Swell"} from the ${compass(fromDeg)} (${Math.round(fromDeg)}°); the sea is to the ${compass(facing)}`}>
      <circle cx={c} cy={c} r={r + 12} fill="var(--slot)" />
      <path d={`M${s1x},${s1y} A${r},${r} 0 0 1 ${s2x},${s2y} Z`} fill="var(--sea)" />
      <path d={`M${s2x},${s2y} A${r},${r} 0 0 1 ${s1x},${s1y} Z`} fill="var(--sand)" />
      <line x1={s1x} y1={s1y} x2={s2x} y2={s2y} stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="1 4" strokeLinecap="round" />
      <text x={seaX} y={seaY + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--accent)" letterSpacing="0.08em">SEA</text>
      <text x={landX} y={landY + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--muted)" letterSpacing="0.08em">LAND</text>
      {(["N", "E", "S", "W"] as const).map((l, i) => {
        const [x, y] = pt(c, c, r + 2, i * 90);
        return <text key={l} x={x} y={y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink-2)">{l}</text>;
      })}
      {kind === "wind" ? (
        <g stroke={color} fill={color} strokeLinecap="round">
          <line x1={ax} y1={ay} x2={bx} y2={by} strokeWidth="5" />
          <path d={head(bx, by, toward)} stroke="none" />
          <circle cx={ax} cy={ay} r="5" />
        </g>
      ) : (
        <g stroke={color} fill={color} strokeLinecap="round">
          {[-14, 0, 14].map((o) => {
            const [x1, y1] = pt(ax, ay, o, fromDeg + 90);
            const [x2, y2] = pt(c, c, o, fromDeg + 90);
            return <line key={o} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={o ? 2 : 4} strokeOpacity={o ? 0.5 : 1} strokeDasharray={o ? "4 5" : undefined} />;
          })}
          <path d={head(c, c, toward)} stroke="none" />
        </g>
      )}
    </svg>
  );
}

/** Échelle horizontale usinée, avec zones nommées et un repère. */
export function Scale({ value, min, max, zones, unit, label }: { value: number; min: number; max: number; zones: { to: number; name: string; color: string }[]; unit: string; label: string }) {
  const W = 300, H = 62, x0 = 6, x1 = W - 6;
  const x = (v: number) => x0 + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (x1 - x0);
  let from = min;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="scale" role="img" aria-label={`${label}: ${value}${unit}`}>
      <rect x={x0 - 3} y="14" width={x1 - x0 + 6} height="16" rx="8" fill="var(--slot)" />
      {zones.map((z) => {
        const a = x(from), b = x(z.to);
        const mid = (a + b) / 2;
        from = z.to;
        return (
          <g key={z.name}>
            <rect x={a + 1} y="17" width={Math.max(0, b - a - 2)} height="10" rx="5" fill={z.color} opacity="0.85" />
            <text x={mid} y={H - 6} textAnchor="middle" fontSize="13" fill="var(--muted)">{z.name}</text>
          </g>
        );
      })}
      <path d={`M${x(value)},12 l-7,-10 h14 z`} fill="var(--ink)" />
      <line x1={x(value)} x2={x(value)} y1="12" y2="32" stroke="var(--ink)" strokeWidth="2.5" />
    </svg>
  );
}

const uvColor = (uv: number) => (uv < 3 ? "oklch(70% 0.15 145)" : uv < 6 ? "oklch(82% 0.15 95)" : uv < 8 ? "oklch(72% 0.16 60)" : uv < 11 ? "oklch(60% 0.2 30)" : "oklch(55% 0.18 320)");
export const UV_ZONES = [
  { to: 3, name: "Low", color: uvColor(1) }, { to: 6, name: "Moderate", color: uvColor(4) }, { to: 8, name: "High", color: uvColor(7) },
  { to: 11, name: "Very high", color: uvColor(9) }, { to: 13, name: "Extreme", color: uvColor(12) },
];
export const WATER_ZONES = [
  { to: 17, name: "Cold", color: "oklch(62% 0.11 245)" }, { to: 19.5, name: "Fresh", color: "oklch(68% 0.09 215)" },
  { to: 22.5, name: "Pleasant", color: "oklch(70% 0.1 185)" }, { to: 26, name: "Warm", color: "oklch(75% 0.12 85)" },
];

/** Flèche de vent compacte pour le ruban : pointe vers où souffle le vent. */
function WindGlyph({ x, y, h }: { x: number; y: number; h: SwimHour }) {
  const len = 9 + Math.min(1, h.wind / 35) * 9;
  const color = sideColor(h.side);
  return (
    <g transform={`translate(${x},${y}) rotate(${(h.windDir + 180) % 360})`} stroke={color} fill={color} strokeLinecap="round">
      <line x1="0" y1={len} x2="0" y2={-len + 6} strokeWidth="3" />
      <path d={`M0,${-len} L-6,${-len + 9} L6,${-len + 9} Z`} stroke="none" />
    </g>
  );
}

/** Ruban horaire : toutes les raisons du score alignées sur le même axe de temps, créneau conseillé en surbrillance. */
export function DayRibbon({ b, now, tide }: { b: Beach; now: Date; tide: TideTable | null }) {
  const hrs = b.hours.slice(0, 24);
  if (hrs.length < 2) return null;
  const W = 1000, L = 92, R = 12;
  const cw = (W - L - R) / hrs.length;
  const cx = (i: number) => L + i * cw + cw / 2;
  const lanes = { day: 14, score: 40, scoreH: 112, wind: 186, windV: 216, surf: 230, surfH: 38, tide: 304, tideH: 34, uv: 372, hour: 400 };
  const H = 410;
  const ys = (s: number) => lanes.score + lanes.scoreH - (s / 10) * lanes.scoreH;
  // Courbe lissée (Catmull-Rom vers Bézier) passant par chaque heure.
  const P = hrs.map((h, i) => [cx(i), ys(h.score)] as const);
  const breaks = hrs.map((h, i) => i > 0 && h.t - hrs[i - 1].t > 3600);
  const segs: (readonly [number, number])[][] = [];
  P.forEach((p, i) => { if (!i || breaks[i]) segs.push([]); segs.at(-1)!.push(p); });
  const smooth = (s: (readonly [number, number])[]) => s.map((p, i) => {
    if (!i) return `M${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const p0 = s[i - 2] ?? s[i - 1], p1 = s[i - 1], p3 = s[i + 1] ?? p;
    const c1 = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6];
    const c2 = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6];
    return `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  }).join(" ");
  const base = lanes.score + lanes.scoreH;
  const bi = b.best ? hrs.findIndex((h) => h.t === b.best!.start) : -1;
  const be = b.best ? hrs.findIndex((h) => h.t === b.best!.end - 3600) : -1;
  const nowI = hrs.findIndex((h) => now.getTime() / 1000 < h.t + 3600);
  const nowX = nowI >= 0 && now.getTime() / 1000 >= hrs[nowI].t - 3600 ? L + nowI * cw + Math.max(0, Math.min(1, (now.getTime() / 1000 - hrs[nowI].t) / 3600)) * cw : null;
  const maxSurf = Math.max(1.5, ...hrs.map((h) => h.surf ?? 0));
  const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-AU", { weekday: "long", timeZone: "Australia/Sydney" });
  // Marée : échantillonnée toutes les 15 min dans chaque colonne horaire.
  const tidePaths: string[] = [];
  const tideMarks: { x: number; kind: string; t: Date }[] = [];
  if (tide) {
    const all = curve(tide, new Date(hrs[0].t * 1000), (hrs.at(-1)!.t - hrs[0].t) / 3600 + 1, 15);
    const yT = (h: number) => lanes.tide + lanes.tideH - ((h + 1.1) / 2.4) * lanes.tideH;
    let cur = "";
    hrs.forEach((h, i) => {
      if (breaks[i] && cur) { tidePaths.push(cur); cur = ""; }
      for (const p of all) {
        const f = (p.t.getTime() / 1000 - h.t) / 3600;
        if (f < 0 || f > 1) continue;
        cur += `${cur ? "L" : "M"}${(L + i * cw + f * cw).toFixed(1)},${yT(p.h).toFixed(1)} `;
      }
    });
    if (cur) tidePaths.push(cur);
    for (const e of tide.extrema) {
      const i = hrs.findIndex((h) => e.t.getTime() / 1000 >= h.t && e.t.getTime() / 1000 < h.t + 3600);
      if (i >= 0) tideMarks.push({ x: L + i * cw + ((e.t.getTime() / 1000 - hrs[i].t) / 3600) * cw, kind: e.kind, t: e.t });
    }
  }
  const laneLabel = (y: number, text: string, sub?: string) => (
    <g>
      <text x="0" y={y} fontSize="13" fontWeight="600" fill="var(--ink-2)">{text}</text>
      {sub && <text x="0" y={y + 15} fontSize="11" fill="var(--muted)">{sub}</text>}
    </g>
  );
  return (
    <svg className="chart ribbon" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Hour by hour: swim score, wind, surf, tide and UV.${b.best ? ` Best window ${time(new Date(b.best.start * 1000))} to ${time(new Date(b.best.end * 1000))}.` : ""}`}>
      <defs>
        <linearGradient id="score-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {bi >= 0 && (
        <g>
          <rect x={L + bi * cw + 2} y={lanes.score - 10} width={((be >= 0 ? be : bi) - bi + 1) * cw - 4} height={H - lanes.score - 4} rx="12" fill="var(--accent)" opacity="0.1" />
          <text x={L + bi * cw + 8} y={lanes.score + lanes.scoreH - 6} fontSize="12" fontWeight="700" fill="var(--accent)">BEST</text>
        </g>
      )}
      {[5, 8].map((s) => <line key={s} x1={L} x2={W - R} y1={ys(s)} y2={ys(s)} stroke="var(--rule)" strokeDasharray="3 6" />)}
      {laneLabel(lanes.score + 40, "Swim score", "out of 10")}
      {segs.map((s, i) => (
        <g key={i}>
          <path d={`${smooth(s)} L${s.at(-1)![0]},${base} L${s[0][0]},${base} Z`} fill="url(#score-fill)" />
          <path d={smooth(s)} fill="none" stroke="var(--accent)" strokeWidth="3" />
        </g>
      ))}
      {hrs.map((h, i) => (
        <g key={h.t} opacity={h.t + 3600 < now.getTime() / 1000 ? 0.4 : 1}>
          <circle cx={cx(i)} cy={ys(h.score)} r="5" fill={scoreColor(h.score)} stroke="var(--paper-2)" strokeWidth="2" />
          <text x={cx(i)} y={ys(h.score) - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink-2)">{h.score.toFixed(h.score >= 10 ? 0 : 1)}</text>
          <WindGlyph x={cx(i)} y={lanes.wind} h={h} />
          <text x={cx(i)} y={lanes.windV} textAnchor="middle" fontSize="11" fill="var(--muted)">{h.wind}</text>
          {h.surf != null && (
            <g>
              <rect x={cx(i) - cw * 0.3} y={lanes.surf + lanes.surfH - (h.surf / maxSurf) * lanes.surfH} width={cw * 0.6} height={(h.surf / maxSurf) * lanes.surfH} rx="4" fill="var(--sea-ink)" opacity={h.pen.surf ? 0.95 : 0.55} />
              <text x={cx(i)} y={lanes.surf + lanes.surfH + 13} textAnchor="middle" fontSize="11" fill="var(--muted)">{h.surf.toFixed(1)}</text>
            </g>
          )}
          <rect x={cx(i) - cw * 0.38} y={lanes.uv - 12} width={cw * 0.76} height="16" rx="5" fill={uvColor(h.uv)} opacity="0.9" />
          <text x={cx(i)} y={lanes.uv} textAnchor="middle" fontSize="11" fontWeight="600" fill="oklch(20% 0.02 80)">{Math.round(h.uv)}</text>
          <text x={cx(i)} y={lanes.hour} textAnchor="middle" fontSize="12" fill="var(--muted)">{time(new Date(h.t * 1000)).slice(0, 2)}</text>
          {(i === 0 || breaks[i]) && <text x={L + i * cw + 4} y={lanes.day} fontSize="12" fontWeight="700" fill="var(--ink-2)">{day(h.t)}</text>}
          {breaks[i] && <line x1={L + i * cw} x2={L + i * cw} y1={4} y2={H - 4} stroke="var(--rule)" strokeWidth="2" />}
        </g>
      ))}
      {laneLabel(lanes.wind - 4, "Wind", "km/h")}
      {laneLabel(lanes.surf + 18, "Surf", "metres")}
      {laneLabel(lanes.tide + 16, "Tide")}
      {laneLabel(lanes.uv - 2, "UV")}
      {tidePaths.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5" />)}
      {tideMarks.map((m) => (
        <text key={m.t.toISOString()} x={m.x} y={m.kind === "high" ? lanes.tide - 5 : lanes.tide + lanes.tideH + 15} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink-2)">
          {m.kind === "high" ? "High" : "Low"} {time(m.t)}
        </text>
      ))}
      {nowX != null && (
        <g>
          <line x1={nowX} x2={nowX} y1={lanes.score - 8} y2={H - 18} stroke="var(--alert)" strokeWidth="1.5" strokeDasharray="3 3" />
          <text x={nowX + 4} y={lanes.score + lanes.scoreH + 14} fontSize="11" fontWeight="700" fill="var(--alert)">now</text>
        </g>
      )}
    </svg>
  );
}

/** Ce qui fait le score : 10 points au départ, chaque facteur en retire, chaque atout est noté. */
export function FactorBars({ reasons, score }: { reasons: BeachReason[]; score: number }) {
  const sorted = [...reasons].sort((a, b) => b.pts - a.pts || (a.effect === "plus" ? -1 : 1));
  const lost = reasons.reduce((a, r) => a + r.pts, 0);
  return (
    <div className="factors">
      <ul>
        {sorted.map((r) => (
          <li key={r.key + r.text} className={r.effect}>
            <span className="f-sign" aria-hidden="true">{r.effect === "plus" ? "+" : r.effect === "minus" ? "−" : "i"}</span>
            <span className="f-text">{r.text}</span>
            <span className={`f-bar${r.pts > 0 ? "" : " none"}`} aria-hidden="true">{r.pts > 0 && <span style={{ width: `${Math.min(100, (r.pts / 6) * 100)}%` }} />}</span>
            <span className="f-pts">{r.pts > 0 ? `−${r.pts}` : ""}</span>
          </li>
        ))}
      </ul>
      <p className="f-sum">10 {lost > 0 ? `− ${Math.round(lost * 10) / 10} ` : ""}= <strong>{score.toFixed(1)}</strong></p>
    </div>
  );
}
