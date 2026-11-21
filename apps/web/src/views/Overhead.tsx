import type { Aircraft, Flights, SourceEntry } from "@maroubra/core";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { CardHead, Empty, Fresh } from "../components/bits";
import land from "../data/sydney-land.json";
import { compass } from "../lib/format";

type E<T> = (SourceEntry<T> & { stale: boolean; ageMin: number | null }) | null;

const HOME = { lat: -33.9496, lon: 151.2577 };
const YSSY = { lat: -33.9461, lon: 151.1772 };
// Projection équirectangulaire locale centrée sur Maroubra, 30 km de rayon environ.
const SPAN_LON = 0.5, SPAN_LAT = SPAN_LON * Math.cos((HOME.lat * Math.PI) / 180);
const W = 1000, H = 640;
const sx = (lon: number) => W / 2 + ((lon - HOME.lon) / SPAN_LON) * W;
const sy = (lat: number) => H / 2 - ((lat - HOME.lat) / SPAN_LAT) * W;
const kmPx = (km: number) => (km / 111.32 / SPAN_LAT) * W;

function landPath(): string {
  const g = land.geometry as { type: string; coordinates: number[][][][] | number[][][] };
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
  return polys.map((poly) => poly.map((ring) => ring.map(([lo, la], i) => `${i ? "L" : "M"}${sx(lo).toFixed(1)},${sy(la).toFixed(1)}`).join(" ") + " Z").join(" ")).join(" ");
}
const LAND = landPath();

const PLANE = "M12 2l1.6 7 7.4 4v2l-7.4-2.5-.6 5.5 2.5 2v1.5L12 20.5 8.5 21.5V20l2.5-2-.6-5.5L3 15v-2l7.4-4z";
const ft = (a: Aircraft) => (a.onGround ? "on ground" : a.altFt != null ? `${a.altFt.toLocaleString("en-AU")} ft` : "n/a");

// Vue de la carte en unités SVG : centre et largeur visible. Bornes : la côte GSHHG chargée s'arrête
// à 150,95° E (x = -115) ; les avions suivis restent à moins de 46 km.
type View = { cx: number; cy: number; w: number };
const X0 = -115, X1 = 1500, Y0 = -1000, Y1 = 1600, MIN_W = 140, MAX_W = 1400;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
function bound(v: View, aspect: number): View {
  const w = clamp(v.w, MIN_W, MAX_W), h = w * aspect;
  return { w, cx: clamp(v.cx, X0 + w / 2, X1 - w / 2), cy: clamp(v.cy, Y0 + h / 2, Y1 - h / 2) };
}

function useWidth(ref: RefObject<HTMLElement>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function PlaneMap({ f, sel, pick }: { f: Flights; sel: string | null; pick: (hex: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pxW = useWidth(box) || W;
  const narrow = pxW < 600;
  // Téléphone : carte carrée, ouverte sur l'anneau des 10 km ; ordinateur : tout le cadre.
  const aspect = narrow ? 1 : H / W;
  const home: View = { cx: sx(HOME.lon), cy: sy(HOME.lat), w: narrow ? 520 : W };
  const [view, setView] = useState<View | null>(null); // null : vue par défaut, centrée sur Maroubra
  const v = view ?? home;
  const vh = v.w * aspect;
  const k = v.w / pxW; // unités SVG par pixel d'écran : textes et symboles gardent leur taille à l'écran
  const left = v.cx - v.w / 2, top = v.cy - vh / 2;

  const zoomAt = (factor: number, px = pxW / 2, py = (pxW * aspect) / 2, from = v) => {
    const kk = from.w / pxW;
    const ux = from.cx - from.w / 2 + px * kk, uy = from.cy - (from.w * aspect) / 2 + py * kk;
    const w = clamp(from.w / factor, MIN_W, MAX_W), r = w / from.w;
    setView(bound({ w, cx: ux + (from.cx - ux) * r, cy: uy + (from.cy - uy) * r }, aspect));
  };

  // Glisser pour déplacer, pincer pour zoomer. Un glissement n'ouvre pas l'avion sous le doigt.
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ v: View; pts: { x: number; y: number }[] } | null>(null);
  const moved = useRef(false);
  const local = (e: React.PointerEvent) => { const r = svg.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const begin = () => { start.current = { v, pts: [...pts.current.values()] }; };
  const onDown = (e: React.PointerEvent) => { pts.current.set(e.pointerId, local(e)); moved.current = false; begin(); };
  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !start.current) return;
    pts.current.set(e.pointerId, local(e));
    const now = [...pts.current.values()], s0 = start.current;
    if (now.length !== s0.pts.length) return begin();
    const kk = s0.v.w / pxW;
    if (now.length === 1) {
      const dx = now[0].x - s0.pts[0].x, dy = now[0].y - s0.pts[0].y;
      if (!moved.current && Math.hypot(dx, dy) < 5) return;
      if (!moved.current) { moved.current = true; svg.current!.setPointerCapture(e.pointerId); }
      setView(bound({ w: s0.v.w, cx: s0.v.cx - dx * kk, cy: s0.v.cy - dy * kk }, aspect));
    } else if (now.length === 2) {
      moved.current = true;
      const d0 = Math.hypot(s0.pts[0].x - s0.pts[1].x, s0.pts[0].y - s0.pts[1].y) || 1;
      const d1 = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y) || 1;
      const m0 = { x: (s0.pts[0].x + s0.pts[1].x) / 2, y: (s0.pts[0].y + s0.pts[1].y) / 2 };
      const m1 = { x: (now[0].x + now[1].x) / 2, y: (now[0].y + now[1].y) / 2 };
      const ux = s0.v.cx - s0.v.w / 2 + m0.x * kk, uy = s0.v.cy - (s0.v.w * aspect) / 2 + m0.y * kk;
      const w = clamp(s0.v.w * (d0 / d1), MIN_W, MAX_W), k1 = w / pxW;
      setView(bound({ w, cx: ux - m1.x * k1 + w / 2, cy: uy - m1.y * k1 + (w * aspect) / 2 }, aspect));
    }
  };
  const onUp = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); begin(); };

  // Molette : seulement avec Ctrl (ou le pincement du pavé tactile), pour ne pas piéger le défilement de la page.
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = svg.current!.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY / 200), e.clientX - r.left, e.clientY - r.top);
  };
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheel.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  const changed = view != null && (Math.abs(view.w - home.w) > 1 || Math.hypot(view.cx - home.cx, view.cy - home.cy) > 2);
  return (
    <div ref={box} className="map-box">
      <svg ref={svg} className="chart map" viewBox={`${left} ${top} ${v.w} ${vh}`} role="img" aria-label={`Map of ${f.aircraft.length} aircraft around Maroubra`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); moved.current = false; } }}>
        <rect x={left} y={top} width={v.w} height={vh} fill="var(--sea)" />
        <path d={LAND} fill="var(--land)" stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {[5, 10, 20].map((km) => (
          <g key={km}>
            <circle cx={sx(HOME.lon)} cy={sy(HOME.lat)} r={kmPx(km)} fill="none" stroke="var(--accent)" strokeOpacity="0.35" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
            <text x={sx(HOME.lon) + kmPx(km) * 0.71 + 4 * k} y={sy(HOME.lat) - kmPx(km) * 0.71 - 4 * k} fontSize={12 * k} fill="var(--accent)">{km} km</text>
          </g>
        ))}
        <text x={sx(YSSY.lon)} y={sy(YSSY.lat) + 34 * k} textAnchor="middle" fontSize={13 * k} fontWeight="700" fill="var(--muted)">Sydney Airport</text>
        <text x={sx(151.17)} y={sy(-34.01)} textAnchor="middle" fontSize={13 * k} fontStyle="italic" fill="var(--muted)">Botany Bay</text>
        <text x={sx(151.45)} y={sy(-33.86)} textAnchor="middle" fontSize={13 * k} fontStyle="italic" fill="var(--muted)">Tasman Sea</text>
        <circle cx={sx(HOME.lon)} cy={sy(HOME.lat)} r={7 * k} fill="var(--accent)" stroke="var(--card)" strokeWidth={3 * k} />
        <text x={sx(HOME.lon) + 12 * k} y={sy(HOME.lat) + 4 * k} fontSize={14 * k} fontWeight="800" fill="var(--ink)">Maroubra</text>
        {f.aircraft.filter((a) => !a.onGround).map((a) => {
          const on = a.hex === sel;
          const color = on ? "var(--alert)" : a.interesting ? "var(--sun)" : "var(--ink)";
          const x = sx(a.lon), y = sy(a.lat);
          return (
            <g key={a.hex} onClick={() => pick(a.hex)} style={{ cursor: "pointer" }}>
              {a.trail.length > 1 && <path d={a.trail.map(([la, lo], i) => `${i ? "L" : "M"}${sx(lo)},${sy(la)}`).join(" ")} fill="none" stroke={color} strokeOpacity="0.4" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
              <circle cx={x} cy={y} r={20 * k} fill="transparent" />
              <g transform={`translate(${x},${y}) scale(${k}) rotate(${a.track ?? 0}) translate(-13,-13)`}>
                <path d={PLANE} transform="scale(1.08)" fill={color} stroke="var(--card)" strokeWidth="1" />
              </g>
              <text x={x + 16 * k} y={y + 4 * k} fontSize={13 * k} fontWeight="700" fill={color}>{a.callsign ?? a.reg ?? a.hex}</text>
            </g>
          );
        })}
        <text x={left + v.w - 10 * k} y={top + vh - 10 * k} textAnchor="end" fontSize={11 * k} fill="var(--muted)">Coast: GSHHG. Positions: adsb.lol</text>
      </svg>
      <div className="map-ctl">
        <button type="button" onClick={() => zoomAt(1.6)} aria-label="Zoom in" disabled={v.w <= MIN_W + 0.5}>+</button>
        <button type="button" onClick={() => zoomAt(1 / 1.6)} aria-label="Zoom out" disabled={v.w >= MAX_W - 0.5}>−</button>
      </div>
      {changed && (
        <button type="button" className="map-reset" onClick={() => setView(null)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" strokeWidth="2" /></svg>
          Back to Maroubra
        </button>
      )}
    </div>
  );
}

export function Overhead({ e }: { e: E<Flights> }) {
  const f = e?.data;
  const [sel, setSel] = useState<string | null>(null);
  if (!f) return <section className="card"><CardHead title="Overhead"><Fresh e={e} /></CardHead><Empty>Waiting for aircraft positions.</Empty></section>;
  const airborne = f.aircraft.filter((a) => !a.onGround);
  const s = airborne.find((a) => a.hex === sel) ?? airborne.find((a) => a.overhead) ?? airborne[0];
  return (
    <section aria-labelledby="ov-title" style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <CardHead title="Above Maroubra"><Fresh e={e} /></CardHead>
        <h1 id="ov-title" className="sr-only">Overhead</h1>
        <p className="lede" style={{ margin: 0 }}>
          {airborne.length} aircraft within 45 km{f.runway ? `. ${f.runway.mode}` : ""}.
          {f.curfew ? " Airport curfew until 06:00: only exempt flights." : ""} {f.seenToday} flights over the suburb today.
        </p>
      </div>
      <div className="card map-card"><PlaneMap f={f} sel={s?.hex ?? null} pick={setSel} /></div>
      <div className="grid">
        {s && (
          <div className="card">
            <h2>{s.callsign ?? s.reg ?? s.hex}{s.rare ? ` · ${s.rare}` : ""}</h2>
            {s.route && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "4px 0 12px" }}>
                <div><div className="big">{s.route.from?.iata ?? "?"}</div><div className="muted">{s.route.from?.location}</div></div>
                <div className="muted">to</div>
                <div style={{ textAlign: "right" }}><div className="big">{s.route.to?.iata ?? "?"}</div><div className="muted">{s.route.to?.location}</div></div>
              </div>
            )}
            <dl className="kv">
              <dt>Aircraft</dt><dd>{s.type ?? "n/a"}{s.reg ? `, ${s.reg}` : ""}</dd>
              <dt>Altitude</dt><dd>{ft(s)}{s.vrate ? (s.vrate > 300 ? ", climbing" : s.vrate < -300 ? ", descending" : "") : ""}</dd>
              <dt>Speed</dt><dd>{s.speedKt != null ? `${Math.round(s.speedKt * 1.852)} km/h` : "n/a"}</dd>
              <dt>From Maroubra</dt><dd>{s.distKm} km {compass(s.bearing)}</dd>
              {s.overhead && <><dt>Overhead</dt><dd>in {s.overhead.inMin} min</dd></>}
            </dl>
          </div>
        )}
        <div className="card">
          <h2>Nearest first</h2>
          <ul className="list planes">
            {airborne.slice(0, 8).map((a) => (
              <li key={a.hex}>
                <button className="row-btn" onClick={() => setSel(a.hex)} aria-pressed={a.hex === s?.hex}>
                  <strong>{a.callsign ?? a.hex}</strong>
                  <span className="muted">{a.route?.codes ?? a.type ?? ""}</span>
                  <span>{ft(a)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
