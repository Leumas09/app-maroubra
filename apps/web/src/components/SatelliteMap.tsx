// Les nuages vus par Himawari-9 autour de Maroubra : image infrarouge calculée par le hub,
// posée sur le trait de côte. Carré de 300 km, nord en haut.
import type { Satellite } from "@maroubra/core";
import coast from "../data/coast-300km.json";
import { time } from "../lib/format";

const SPAN = coast.spanKm;

export function SatelliteMap({ s }: { s: Satellite }) {
  const c = SPAN / 2;
  return (
    <svg className="chart sat" viewBox={`0 0 ${SPAN} ${SPAN}`} role="img"
      aria-label={`Satellite view of the clouds within 150 km of Maroubra at ${time(new Date(s.at))}`}>
      <defs><clipPath id="sat-clip"><rect width={SPAN} height={SPAN} rx="6" /></clipPath></defs>
      <g clipPath="url(#sat-clip)">
        <rect width={SPAN} height={SPAN} fill="var(--sat-sea)" />
        <path d={coast.path} fill="var(--sat-land)" />
        <image href={`/api/satellite.png?t=${encodeURIComponent(s.at)}`} x="0" y="0" width={s.spanKm} height={s.spanKm} preserveAspectRatio="none" />
        <path d={coast.path} fill="none" stroke="var(--sat-coast)" strokeWidth="0.6" />
        <circle cx={c} cy={c} r="50" fill="none" stroke="var(--sat-coast)" strokeDasharray="2 3" strokeWidth="0.6" />
        <text x={c + 36} y={c - 38} fontSize="7" fill="var(--sat-coast)">50 km</text>
        <circle cx={c} cy={c} r="2.6" fill="var(--alert)" stroke="white" strokeWidth="0.8" />
        <text x={c + 5} y={c + 2.5} fontSize="8" fontWeight="700" fill="white" stroke="var(--sat-sea)" strokeWidth="2" paintOrder="stroke">Maroubra</text>
        <text x={SPAN - 4} y={SPAN - 4} textAnchor="end" fontSize="6" fill="var(--sat-coast)">Himawari-9 (JMA) via NOAA. Coast: GSHHG</text>
      </g>
    </svg>
  );
}

/** Une phrase sur la couverture nuageuse, d'après le satellite. */
export function cloudText(s: Satellite): string {
  const o = s.overhead, r = s.within50km;
  if (!o || !r) return "No clear view from the satellite right now.";
  // L'infrarouge seul classe mal les étages (cirrus fins pris pour du bas) : on ne nomme que les
  // sommets très froids, sûrement hauts (orages, enclumes, cirrus épais).
  const high = (x: { high: number; total: number }) => (x.high >= 20 ? ", with high, cold cloud tops" : "");
  const over = o.total < 10 ? "Clear above Maroubra" : o.total > 80 ? `Cloud over Maroubra${high(o)}` : `Some cloud over Maroubra (${o.total}%)${high(o)}`;
  const around = r.total < 10 ? "and clear for 50 km around" : `${r.total}% cloud within 50 km`;
  return `${over}, ${around}.`;
}
