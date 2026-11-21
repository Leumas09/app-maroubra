// Carte des avions : fond Leaflet (zoom, déplacement, fonds au choix) et un calque canvas redessiné en continu,
// où chaque avion avance entre deux relevés (voir lib/motion). Un clic près d'un avion le sélectionne.
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { Aircraft } from "@maroubra/core";
import { useEffect, useRef } from "react";
import land from "../data/sydney-land.json";
import { path2d, shapeOf, SIZE } from "../lib/aircraft-shapes";
import type { Motion } from "../lib/motion";

export const HOME: [number, number] = [-33.9496, 151.2577];
const YSSY: [number, number] = [-33.9461, 151.1772];

/** Cadrage de départ (et du bouton « Home ») : 15 km autour de la maison. */
const VIEW_RADIUS_M = 15_000;

export type Base = "map" | "satellite" | "plain";

const TILES: Record<Exclude<Base, "plain">, { url: (night: boolean) => string; attribution: string; max: number }> = {
  // Carte OpenStreetMap standard (sans clé, usage léger permis avec crédit et en-tête Referer) ;
  // la nuit, la feuille de style l'assombrit (filtre sur le calque des tuiles).
  map: {
    url: () => "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    max: 19,
  },
  satellite: {
    url: () => "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    max: 17,
  },
};

export const label = (a: Aircraft) => a.flightNo ?? a.callsign ?? a.reg ?? a.hex.toUpperCase();

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

interface Props {
  aircraft: Aircraft[];
  motion: Motion;
  selected: string | null;
  follow: boolean;
  base: Base;
  night: boolean;
  onPick: (hex: string) => void;
  onStopFollow: () => void;
  /** Réduit les animations : une image par seconde. */
  calm: boolean;
  /** Change à chaque demande de retour sur la maison. */
  homeTick: number;
  /** Agrégateur des positions, crédité sur la carte. */
  source: string;
}

export function FlightMap(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const coast = useRef<L.GeoJSON | null>(null);
  const props = useRef(p);
  props.current = p;

  // Carte créée une seule fois.
  useEffect(() => {
    const m = L.map(box.current!, { zoomControl: true, attributionControl: true, zoomAnimation: false, zoomSnap: 0.5, minZoom: 7, maxZoom: 17, worldCopyJump: false });
    m.fitBounds(L.latLng(HOME).toBounds(2 * VIEW_RADIUS_M));
    m.attributionControl.setPrefix(false);
    // Trait de côte local, sans réseau : fond « Plain » seulement (au-dessus des tuiles, il masquerait la carte).
    coast.current = L.geoJSON(land.geometry as never, { interactive: false, attribution: "Coastline © OpenStreetMap contributors", style: { stroke: true, color: "var(--rule)", weight: 1, fillColor: "var(--land)", fillOpacity: 1 } });
    for (const km of [5, 10, 20]) L.circle(HOME, { radius: km * 1000, interactive: false, color: "var(--accent)", opacity: 0.45, weight: 1, dashArray: "4 6", fill: false }).addTo(m);
    L.circleMarker(HOME, { radius: 6, color: "var(--paper)", weight: 3, fillColor: "var(--accent)", fillOpacity: 1, interactive: false }).addTo(m)
      .bindTooltip("Maroubra", { permanent: true, direction: "right", className: "map-tip home" });
    L.circleMarker(YSSY, { radius: 0, opacity: 0, interactive: false }).addTo(m)
      .bindTooltip("Sydney Airport", { permanent: true, direction: "bottom", offset: [0, 18], className: "map-tip" });

    const hit = (pt: L.Point) => {
      const t = Date.now();
      let best: { hex: string; d: number } | null = null;
      for (const a of props.current.aircraft) {
        const pos = props.current.motion.pos(a.hex, t);
        if (!pos) continue;
        const d = m.latLngToContainerPoint(pos).distanceTo(pt);
        if (d < 26 && (!best || d < best.d)) best = { hex: a.hex, d };
      }
      return best?.hex ?? null;
    };
    m.on("click", (e: L.LeafletMouseEvent) => { const h = hit(e.containerPoint); if (h) props.current.onPick(h); });
    m.on("mousemove", (e: L.LeafletMouseEvent) => { box.current!.style.cursor = hit(e.containerPoint) ? "pointer" : ""; });
    m.on("dragstart", () => props.current.onStopFollow());
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // Fond de carte.
  useEffect(() => {
    const m = map.current!;
    tiles.current?.remove();
    if (p.base === "plain") coast.current!.addTo(m);
    else coast.current!.remove();
    tiles.current = null;
    if (p.base !== "plain") {
      const t = TILES[p.base];
      tiles.current = L.tileLayer(t.url(p.night), { attribution: t.attribution, maxZoom: t.max, maxNativeZoom: t.max, referrerPolicy: "strict-origin-when-cross-origin" }).addTo(m);
    }
    box.current!.dataset.base = p.base;
    box.current!.dataset.night = p.night ? "1" : "";
  }, [p.base, p.night]);

  useEffect(() => {
    const a = map.current!.attributionControl, text = `Positions: ${p.source}`;
    a.addAttribution(text);
    return () => { a.removeAttribution(text); };
  }, [p.source]);

  useEffect(() => { if (p.homeTick) map.current?.fitBounds(L.latLng(HOME).toBounds(2 * VIEW_RADIUS_M)); }, [p.homeTick]);

  // Boucle de dessin.
  useEffect(() => {
    let raf = 0, last = 0, lastFollow = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const { aircraft, motion, selected, follow, base, calm } = props.current;
      if (now - last < (calm ? 1000 : 33)) return;
      last = now;
      const m = map.current, cv = canvas.current;
      if (!m || !cv) return;
      const size = m.getSize(), dpr = window.devicePixelRatio || 1;
      if (cv.width !== size.x * dpr || cv.height !== size.y * dpr) { cv.width = size.x * dpr; cv.height = size.y * dpr; cv.style.width = `${size.x}px`; cv.style.height = `${size.y}px`; }
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      const t = Date.now();
      const zoom = m.getZoom();
      const sat = base === "satellite";
      const col = { ink: sat ? "#FFE27A" : css("--ink"), sun: css("--sun"), accent: css("--accent"), alert: css("--alert"), paper: sat ? "#1a1a1a" : css("--paper"), muted: css("--muted") };
      const pulse = 0.5 + 0.5 * Math.sin(t / 250);

      if (follow && selected && now - lastFollow > 100) {
        const pos = motion.pos(selected, t);
        if (pos) m.setView(pos, zoom, { animate: false });
        lastFollow = now;
      }

      const list = [...aircraft].sort((a, b) => Number(a.hex === selected) - Number(b.hex === selected) || Number(!!a.emergency) - Number(!!b.emergency));
      for (const a of list) {
        if (a.onGround && zoom < 12) continue;
        const pos = motion.pos(a.hex, t);
        if (!pos) continue;
        const pt = m.latLngToContainerPoint(pos);
        if (pt.x < -60 || pt.y < -60 || pt.x > size.x + 60 || pt.y > size.y + 60) continue;
        const on = a.hex === selected;
        const color = a.emergency ? col.alert : on ? col.accent : a.interesting ? col.sun : a.onGround ? col.muted : col.ink;

        // Trace, prolongée jusqu'à la position affichée.
        if (a.trail.length > 1) {
          ctx.beginPath();
          a.trail.forEach(([la, lo], i) => { const q = m.latLngToContainerPoint([la, lo]); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
          ctx.lineTo(pt.x, pt.y);
          ctx.strokeStyle = color; ctx.globalAlpha = on ? 0.8 : 0.4; ctx.lineWidth = on ? 3 : 2; ctx.lineJoin = "round";
          ctx.stroke(); ctx.globalAlpha = 1;
        }
        if (a.emergency) {
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 22 + 8 * pulse, 0, Math.PI * 2);
          ctx.strokeStyle = col.alert; ctx.globalAlpha = 1 - pulse * 0.6; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1;
        }
        if (on) {
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 22, 0, Math.PI * 2);
          ctx.fillStyle = col.accent; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
        }
        const shape = shapeOf(a);
        const s = SIZE[shape] * (a.onGround ? 0.7 : 1) * (zoom >= 13 ? 1.2 : 1);
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(((a.track ?? 0) * Math.PI) / 180);
        ctx.scale(s / 32, s / 32);
        ctx.translate(-16, -16);
        const path = path2d(shape);
        ctx.lineWidth = 2.4; ctx.strokeStyle = col.paper; ctx.lineJoin = "round"; ctx.stroke(path);
        ctx.fillStyle = color; ctx.fill(path);
        ctx.restore();

        if (a.onGround && !on) continue;
        // Étiquette : vol, puis altitude dès qu'on zoome (ou pour l'avion choisi).
        const x = pt.x + s / 2 + 4;
        ctx.font = "700 13px 'Figtree Variable', system-ui, sans-serif";
        ctx.lineWidth = 3.5; ctx.strokeStyle = col.paper; ctx.fillStyle = color;
        ctx.strokeText(label(a), x, pt.y + 1); ctx.fillText(label(a), x, pt.y + 1);
        if (on || zoom >= 11) {
          const sub = a.onGround ? "ground" : a.altFt != null ? (a.altFt >= 10000 ? `FL${Math.round(a.altFt / 100)}` : `${a.altFt.toLocaleString("en-AU")} ft`) : "";
          ctx.font = "500 11px 'Figtree Variable', system-ui, sans-serif";
          ctx.fillStyle = sat ? "#fff" : col.muted;
          ctx.strokeText(sub, x, pt.y + 15); ctx.fillText(sub, x, pt.y + 15);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flight-map" ref={box} role="application" aria-label={`Live map of ${p.aircraft.filter((a) => !a.onGround).length} aircraft around Maroubra. Use the list below to pick an aircraft.`}>
      <canvas ref={canvas} className="flight-canvas" aria-hidden="true" />
    </div>
  );
}
