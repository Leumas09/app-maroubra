// Carte du ciel au-dessus de Maroubra : projection azimutale équidistante, zénith au centre, horizon au bord,
// nord en haut et est à gauche (comme une carte tenue au-dessus de la tête). Étoiles du catalogue Hipparcos
// jusqu'à la magnitude 5, constellations, Voie lactée, planètes, Lune et Soleil. Toucher un astre le nomme.
import { astronomy as A, horizontal, moonIllumination, starsHorizontal, type Body } from "@maroubra/sky";
import { useMemo, useState } from "react";
import { compass, time } from "../lib/format";

export interface Catalog {
  stars: [ra: number, dec: number, mag: number, bv: number, name: string, hip: number][];
  lines: [number, number][][];
  cons: [ra: number, dec: number, name: string, rank: number][];
  mw: [number, number][][][];
}

const S = 640, C = S / 2, R = S / 2 - 26;
/** Hauteur et azimut vers le dessin (l'horizon est au rayon R, le zénith au centre). */
const xy = (alt: number, az: number): [number, number] => {
  const r = ((90 - alt) / 90) * R, a = (az * Math.PI) / 180;
  return [C - r * Math.sin(a), C - r * Math.cos(a)];
};
/** Couleur d'une étoile d'après son indice B-V (bleutée à orangée). */
const starColor = (bv: number) => (bv < 0 ? "#cfe0ff" : bv < 0.5 ? "#f4f6ff" : bv < 1 ? "#fff3d6" : bv < 1.5 ? "#ffd9a8" : "#ffbe8a");
const starR = (mag: number) => Math.max(0.7, 3.8 - mag * 0.65);

interface Picked { name: string; kind: string; alt: number; az: number; mag?: number }

export function SkyChart({ catalog, at, night }: { catalog: Catalog; at: Date; night: boolean }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const view = useMemo(() => {
    const st = starsHorizontal(catalog.stars.map((s) => ({ ra: s[0], dec: s[1] })), at);
    const stars = catalog.stars.map((s, i) => ({ s, h: st[i] })).filter((x) => x.h.alt > -1);
    const lines = catalog.lines.map((l) => starsHorizontal(l.map(([ra, dec]) => ({ ra, dec })), at, false));
    const consH = starsHorizontal(catalog.cons.map((c) => ({ ra: c[0], dec: c[1] })), at, false);
    const cons = catalog.cons.map((c, i) => ({ c, h: consH[i] })).filter((x) => x.h.alt > 12 && x.c[3] <= 2);
    const mw = catalog.mw.map((level) => level.map((ring) => starsHorizontal(ring.map(([ra, dec]) => ({ ra, dec })), at, false)));
    const bodies = (["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as Body[]).map((b) => {
      const h = horizontal(b, at);
      return { b, h, mag: b === "Sun" || b === "Moon" ? undefined : A.Illumination(b, at).mag };
    }).filter((x) => x.h.alt > -1);
    return { stars, lines, cons, mw, bodies };
  }, [catalog, at]);

  const sunUp = view.bodies.some((x) => x.b === "Sun" && x.h.alt > -6);
  const path = (pts: { alt: number; az: number }[], close = false) => pts.map((p, i) => { const [x, y] = xy(p.alt, p.az); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join("") + (close ? "Z" : "");
  const illum = moonIllumination(at);

  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget, pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    let best: (Picked & { d: number }) | null = null;
    const consider = (o: Picked) => { const [x, y] = xy(o.alt, o.az); const d = Math.hypot(x - p.x, y - p.y); if (d < 18 && (!best || d < best.d)) best = { ...o, d }; };
    for (const { b, h, mag } of view.bodies) consider({ name: b, kind: b === "Sun" || b === "Moon" ? b : "Planet", alt: h.alt, az: h.az, mag });
    for (const { s, h } of view.stars) if (s[2] < 4) consider({ name: s[4] || `Star HIP ${s[5]}`, kind: "Star", alt: h.alt, az: h.az, mag: s[2] });
    setPicked(best);
  };

  return (
    <div className="skychart">
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Sky chart over Maroubra at ${time(at)}: north at the top, east on the left. ${view.bodies.filter((x) => x.h.alt > 0).map((x) => x.b).join(", ")} above the horizon.`} onClick={pick}>
        <defs>
          <clipPath id="sky-disc"><circle cx={C} cy={C} r={R} /></clipPath>
          <radialGradient id="sky-bg"><stop offset="0" stopColor={sunUp ? "oklch(62% 0.08 235)" : "oklch(18% 0.04 260)"} /><stop offset="1" stopColor={sunUp ? "oklch(78% 0.06 220)" : "oklch(26% 0.05 250)"} /></radialGradient>
        </defs>
        <circle cx={C} cy={C} r={R} fill="url(#sky-bg)" />
        <g clipPath="url(#sky-disc)">
          {view.mw.map((level, li) => level.map((ring, i) => <path key={`${li}-${i}`} d={path(ring, true)} fill="#fff" fillOpacity={sunUp ? 0 : li === 0 ? 0.05 : 0.04} fillRule="evenodd" />))}
          {[30, 60].map((alt) => <circle key={alt} cx={C} cy={C} r={((90 - alt) / 90) * R} fill="none" stroke="#fff" strokeOpacity="0.12" strokeDasharray="3 6" />)}
          {!sunUp && view.lines.map((l, i) => <path key={i} d={path(l)} fill="none" stroke="#9fb6ff" strokeOpacity="0.35" strokeWidth="1" />)}
          {!sunUp && view.stars.map(({ s, h }) => { const [x, y] = xy(h.alt, h.az); return <circle key={s[5]} cx={x} cy={y} r={starR(s[2])} fill={starColor(s[3])} />; })}
          {!sunUp && view.cons.map(({ c, h }) => { const [x, y] = xy(h.alt, h.az); return <text key={c[2]} x={x} y={y} textAnchor="middle" fontSize="11" fill="#c9d4ff" fillOpacity="0.55" letterSpacing="0.08em">{c[2].toUpperCase()}</text>; })}
          {!sunUp && view.stars.filter(({ s, h }) => s[2] < 1.3 && s[4] && h.alt > 5).map(({ s, h }) => { const [x, y] = xy(h.alt, h.az); return <text key={`n${s[5]}`} x={x + 7} y={y + 4} fontSize="12" fill="#fff" fillOpacity="0.8">{s[4]}</text>; })}
          {view.bodies.map(({ b, h, mag }) => {
            const [x, y] = xy(h.alt, h.az);
            if (b === "Sun") return <g key={b}><circle cx={x} cy={y} r="14" fill="oklch(85% 0.16 90)" /><text x={x + 18} y={y + 5} fontSize="14" fontWeight="700" fill="#fff">Sun</text></g>;
            if (b === "Moon") return (
              <g key={b}>
                <circle cx={x} cy={y} r="11" fill="#2a3042" stroke="#fff" strokeOpacity="0.4" />
                <circle cx={x} cy={y} r="11" fill="#f4f1e6" clipPath={undefined} opacity={0.25 + illum * 0.75} />
                <text x={x + 15} y={y + 5} fontSize="14" fontWeight="700" fill="#fff">Moon {Math.round(illum * 100)}%</text>
              </g>
            );
            return <g key={b}><circle cx={x} cy={y} r={Math.max(3.5, 5.5 - (mag ?? 1))} fill="oklch(86% 0.13 85)" stroke="#000" strokeOpacity="0.4" /><text x={x + 9} y={y + 5} fontSize="13" fontWeight="700" fill="oklch(88% 0.12 85)">{b}</text></g>;
          })}
          {picked && (() => { const [x, y] = xy(picked.alt, picked.az); return <circle cx={x} cy={y} r="16" fill="none" stroke="var(--accent)" strokeWidth="2.5" />; })()}
        </g>
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--rule)" strokeWidth="2" />
        {[["N", 0], ["E", 90], ["S", 180], ["W", 270]].map(([l, az]) => { const [x, y] = xy(-12, az as number); return <text key={l} x={x} y={y + 5} textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--ink)">{l}</text>; })}
      </svg>
      <p className="skychart-info" aria-live="polite">
        {picked
          ? <><strong>{picked.name}</strong> {picked.kind !== picked.name ? `(${picked.kind.toLowerCase()})` : ""}: {Math.round(picked.alt)}° above the horizon, towards the {compass(picked.az)}{picked.mag != null ? `, magnitude ${picked.mag.toFixed(1)}` : ""}.</>
          : sunUp ? "Daytime: the stars are there but drowned by daylight. Move the time to tonight." : night ? "Tap a star or a planet to name it. Hold the chart above your head with north to the top." : "Tap a star or a planet to name it."}
      </p>
    </div>
  );
}
