// Image satellite réelle des nuages autour de Maroubra : Himawari-9 (JMA), bande 13 (infrarouge 10,4 µm,
// 2 km), archive NOAA sur AWS, sans clé, toutes les 10 minutes, de jour comme de nuit.
// On ne télécharge que les deux segments du disque complet qui couvrent Sydney (environ 5 Mo).
// Lecture du format HSD d'après le « Himawari Standard Data User's Guide » (JMA, v1.3) ;
// navigation par la projection géostationnaire normalisée de la CGMS (LRIT/HRIT Global Specification).
import Bunzip from "seek-bzip";
import { deflateSync } from "node:zlib";
import type { Satellite, SatelliteCloud } from "@maroubra/core";
import { astronomy as A, horizontal, riseSet } from "@maroubra/sky";
import { SITE } from "../config";
import { scoreSunrise } from "../derive/sunrise";
import { destination } from "../geo";
import { fetchBytes, fetchText } from "../http";
import type { Collector } from "../collector";

const BUCKET = "https://noaa-himawari9.s3.amazonaws.com";
// Le carré de 300 km autour de Maroubra tombe dans les lignes 4401 à 4517 du disque : segment 9 seul.
export const SEGMENTS = ["0910"];
const MAX_LINE = 4530;

export interface Hsd {
  cols: number;
  lines: number;
  firstLine: number;
  subLon: number;
  cfac: number;
  lfac: number;
  coff: number;
  loff: number;
  /** Comptes bruts → température de brillance (K). */
  tb: (count: number) => number;
  counts: Uint16Array;
  errorCount: number;
}

/**
 * Les fichiers .bz2 de la NOAA sont faits de flux bzip2 indépendants de 900 000 octets décompressés.
 * On découpe aux débuts de flux (« BZh » + chiffre + signature de bloc 0x314159265359), et on ne décode
 * que les premiers, jusqu'à la dernière ligne utile : environ 7 fois moins de calcul.
 */
export function bz2Streams(buf: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  for (let i = 0; i + 10 <= buf.length; i++) {
    if (buf[i] === 0x42 && buf[i + 1] === 0x5a && buf[i + 2] === 0x68 && buf[i + 3] >= 0x31 && buf[i + 3] <= 0x39 &&
      buf[i + 4] === 0x31 && buf[i + 5] === 0x41 && buf[i + 6] === 0x59 && buf[i + 7] === 0x26 && buf[i + 8] === 0x53 && buf[i + 9] === 0x59) starts.push(i);
  }
  return starts.map((s, k) => buf.subarray(s, starts[k + 1] ?? buf.length));
}

/** Décompresse le début d'un segment, jusqu'à la ligne `maxLine` incluse. */
export function decodeHead(bz: Uint8Array, maxLine = MAX_LINE): Uint8Array {
  const parts: Buffer[] = [];
  let have = 0, need = Infinity;
  for (const st of bz2Streams(bz)) {
    const out = Bunzip.decode(Buffer.from(st.buffer, st.byteOffset, st.byteLength), null, false);
    parts.push(out);
    have += out.length;
    if (need === Infinity && have >= 1600) {
      const head = Buffer.concat(parts);
      const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
      const headerLen = dv.getUint32(70, true);
      const b2 = dv.getUint16(1, true);
      const cols = dv.getUint16(b2 + 5, true), lines = dv.getUint16(b2 + 7, true);
      let off = 0, first = 0;
      for (let b = 1; b <= 7; b++) { if (b === 7) first = dv.getUint16(off + 5, true); off += dv.getUint16(off + 1, true); }
      need = headerLen + Math.min(lines, Math.max(0, maxLine - first + 1)) * cols * 2;
    }
    if (have >= need) break;
  }
  return Buffer.concat(parts);
}

/** Décode un segment HSD décompressé (éventuellement seulement son début). Petit-boutiste. */
export function decodeHsd(buf: Uint8Array): Hsd {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const blockAt: number[] = [];
  let off = 0;
  for (let b = 1; b <= 11; b++) {
    if (dv.getUint8(off) !== b) throw new Error(`HSD: block ${b} expected at ${off}`);
    blockAt[b] = off;
    off += dv.getUint16(off + 1, true);
  }
  const headerLen = dv.getUint32(blockAt[1] + 70, true);
  const b2 = blockAt[2], b3 = blockAt[3], b5 = blockAt[5], b7 = blockAt[7];
  const cols = dv.getUint16(b2 + 5, true), lines = dv.getUint16(b2 + 7, true);
  const subLon = dv.getFloat64(b3 + 3, true);
  const cfac = dv.getUint32(b3 + 11, true), lfac = dv.getUint32(b3 + 15, true);
  const coff = dv.getFloat32(b3 + 19, true), loff = dv.getFloat32(b3 + 23, true);
  const waveUm = dv.getFloat64(b5 + 5, true);
  const errorCount = dv.getUint16(b5 + 15, true);
  const gain = dv.getFloat64(b5 + 19, true), offset = dv.getFloat64(b5 + 27, true);
  const c0 = dv.getFloat64(b5 + 35, true), c1 = dv.getFloat64(b5 + 43, true), c2 = dv.getFloat64(b5 + 51, true);
  const firstLine = dv.getUint16(b7 + 5, true);
  // Constantes de Planck (SI) ; la radiance HSD est en W m⁻² sr⁻¹ µm⁻¹.
  const h = 6.62606957e-34, c = 2.99792458e8, k = 1.3806488e-23, lam = waveUm * 1e-6;
  const tb = (count: number) => {
    const L = (count * gain + offset) * 1e6;
    if (L <= 0) return NaN;
    const te = (h * c) / (k * lam) / Math.log(1 + (2 * h * c * c) / (lam ** 5 * L));
    return c0 + c1 * te + c2 * te * te;
  };
  const start = headerLen;
  const avail = Math.min(lines, Math.floor((buf.byteLength - start) / (cols * 2)));
  const counts = new Uint16Array(cols * avail);
  for (let i = 0; i < counts.length; i++) counts[i] = dv.getUint16(start + i * 2, true);
  return { cols, lines: avail, firstLine, subLon, cfac, lfac, coff, loff, tb, counts, errorCount };
}

/** Latitude, longitude → colonne et ligne (1-indexées) du disque, projection géostationnaire normalisée. */
export function geosPixel(lat: number, lon: number, h: Pick<Hsd, "subLon" | "cfac" | "lfac" | "coff" | "loff">): { col: number; line: number } | null {
  const rad = Math.PI / 180;
  const cLat = Math.atan(0.993305616 * Math.tan(lat * rad));
  const rl = 6356.7523 / Math.sqrt(1 - 0.00669438444 * Math.cos(cLat) ** 2);
  const dl = (lon - h.subLon) * rad;
  const r1 = 42164 - rl * Math.cos(cLat) * Math.cos(dl);
  const r2 = -rl * Math.cos(cLat) * Math.sin(dl);
  const r3 = rl * Math.sin(cLat);
  if (r1 * 42164 - (r1 * r1 + r2 * r2 + r3 * r3) < 0) return null; // face cachée
  const rn = Math.hypot(r1, r2, r3);
  const x = Math.atan(-r2 / r1) / rad, y = Math.asin(-r3 / rn) / rad;
  return { col: h.coff + x * 2 ** -16 * h.cfac, line: h.loff + y * 2 ** -16 * h.lfac };
}

/** Grille locale centrée sur Maroubra : `size` × `size` pixels de `km` km, nord en haut. */
export interface Grid { size: number; km: number; tb: Float32Array }

export function localGrid(segs: Hsd[], size = 200, km = 1.5): Grid {
  const tb = new Float32Array(size * size).fill(NaN);
  const kmPerDegLat = 110.57, kmPerDegLon = 111.32 * Math.cos((SITE.lat * Math.PI) / 180);
  const cache = new Map<number, number>();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (i + 0.5 - size / 2) * km, dy = (size / 2 - j - 0.5) * km;
      const p = geosPixel(SITE.lat + dy / kmPerDegLat, SITE.lon + dx / kmPerDegLon, segs[0]);
      if (!p) continue;
      const line = Math.round(p.line), col = Math.round(p.col);
      const s = segs.find((x) => line >= x.firstLine && line < x.firstLine + x.lines);
      if (!s || col < 1 || col > s.cols) continue;
      const count = s.counts[(line - s.firstLine) * s.cols + (col - 1)];
      if (count === 65535 || count === 65534 || count === 0) continue;
      let v = cache.get(count);
      if (v === undefined) { v = s.tb(count); cache.set(count, v); }
      tb[j * size + i] = v;
    }
  }
  return { size, km, tb };
}

/** Température du ciel clair : les pixels les plus chauds de la scène (mer libre), 97e centile. */
export function clearRef(g: Grid): number {
  const v = [...g.tb].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length * 0.97)] : NaN;
}

/**
 * Ciel clair local, par blocs d'environ 30 km : la nuit, la terre est plus froide que la mer et passerait
 * pour du nuage bas. La référence locale descend au plus de 10 K sous celle de la scène, pour que les
 * vrais nuages, plus froids encore, restent détectés.
 */
export function localRef(g: Grid, ref = clearRef(g), block = 20): Float32Array {
  const nb = Math.ceil(g.size / block);
  const blocks = new Float32Array(nb * nb).fill(ref);
  for (let bj = 0; bj < nb; bj++) for (let bi = 0; bi < nb; bi++) {
    const v: number[] = [];
    for (let j = bj * block; j < Math.min(g.size, (bj + 1) * block); j++) for (let i = bi * block; i < Math.min(g.size, (bi + 1) * block); i++) {
      const t = g.tb[j * g.size + i];
      if (Number.isFinite(t)) v.push(t);
    }
    if (v.length > 20) { v.sort((a, b) => a - b); blocks[bj * nb + bi] = Math.min(ref, Math.max(ref - 10, v[Math.floor(v.length * 0.95)])); }
  }
  const out = new Float32Array(g.size * g.size);
  for (let j = 0; j < g.size; j++) for (let i = 0; i < g.size; i++) {
    // Interpolation bilinéaire entre centres de blocs, pour éviter les marches dans l'image.
    const fx = Math.max(0, Math.min(nb - 1, (i + 0.5) / block - 0.5)), fy = Math.max(0, Math.min(nb - 1, (j + 0.5) / block - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(nb - 1, x0 + 1), y1 = Math.min(nb - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    out[j * g.size + i] = (blocks[y0 * nb + x0] * (1 - ax) + blocks[y0 * nb + x1] * ax) * (1 - ay) + (blocks[y1 * nb + x0] * (1 - ax) + blocks[y1 * nb + x1] * ax) * ay;
  }
  return out;
}

/**
 * Nuages au-dessus d'un point (rayon `rKm`), par température du sommet : hauts sous 233 K (−40 °C),
 * moyens de 233 à 263 K, bas au-dessus ; nuageux si plus froid que le ciel clair local de 4 K au moins.
 * Limites connues de l'infrarouge seul : cirrus fins et stratus très bas sont sous-estimés.
 */
export function cloudAt(g: Grid, ref: Float32Array, dxKm: number, dyKm: number, rKm = 15): SatelliteCloud | null {
  let n = 0, low = 0, mid = 0, high = 0;
  const r = Math.ceil(rKm / g.km);
  const ci = Math.floor(g.size / 2 + dxKm / g.km), cj = Math.floor(g.size / 2 - dyKm / g.km);
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (i < 0 || j < 0 || i >= g.size || j >= g.size || (i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
    const t = g.tb[j * g.size + i];
    if (!Number.isFinite(t)) continue;
    n++;
    if (t > ref[j * g.size + i] - 4) continue;
    if (t < 233) high++; else if (t < 263) mid++; else low++;
  }
  if (n < 10) return null;
  const pc = (x: number) => Math.round((x / n) * 100);
  return { low: pc(low), mid: pc(mid), high: pc(high), total: pc(low + mid + high) };
}

/** Encodeur PNG minimal (niveaux de gris + transparence), sans dépendance. */
export function png(width: number, height: number, gray: Uint8Array, alpha: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 2 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 2 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      raw[y * (width * 2 + 1) + 1 + x * 2] = gray[y * width + x];
      raw[y * (width * 2 + 1) + 2 + x * 2] = alpha[y * width + x];
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 4; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Rendu « infrarouge amélioré » : le ciel clair est transparent (la carte en dessous se voit), les nuages
 * sont d'autant plus blancs et opaques que leur sommet est froid, donc haut.
 */
export function render(g: Grid, ref: Float32Array): Buffer {
  const gray = new Uint8Array(g.size * g.size), alpha = new Uint8Array(g.size * g.size);
  for (let i = 0; i < g.tb.length; i++) {
    const t = g.tb[i];
    if (!Number.isFinite(t)) continue;
    const cold = Math.max(0, Math.min(1, (ref[i] - 3 - t) / (ref[i] - 3 - 205)));
    gray[i] = Math.round(170 + 85 * cold);
    alpha[i] = Math.round(255 * Math.min(1, cold * 2.2));
  }
  return png(g.size, g.size, gray, alpha);
}

async function latestSlot(now: Date): Promise<string> {
  for (const back of [0, 1]) {
    const d = new Date(now.getTime() - back * 86400e3).toISOString().slice(0, 10).replace(/-/g, "/");
    const xml = await fetchText(`${BUCKET}/?list-type=2&prefix=AHI-L1b-FLDK/${d}/&delimiter=/`);
    const slots = [...xml.matchAll(/<Prefix>(AHI-L1b-FLDK\/\d{4}\/\d{2}\/\d{2}\/\d{4}\/)<\/Prefix>/g)].map((m) => m[1]);
    // Le plus récent dont les deux segments de la bande 13 sont publiés.
    for (const slot of slots.reverse().slice(0, 4)) {
      const list = await fetchText(`${BUCKET}/?list-type=2&prefix=${slot}&max-keys=200`);
      if (SEGMENTS.every((s) => list.includes(`_B13_FLDK_R20_S${s}.DAT.bz2`))) return slot;
    }
  }
  throw new Error("no complete Himawari slot");
}

export interface SatelliteState { data: Satellite; png: Buffer }

/** Image et nuages autour de Maroubra pour un créneau (« AHI-L1b-FLDK/2026/11/21/1200/ »). */
export async function satelliteAt(slot: string, sunriseAz: number | null): Promise<SatelliteState> {
  const [, , y, mo, d, hm] = slot.split("/");
  const segs: Hsd[] = [];
  for (const s of SEGMENTS) {
    const bz = new Uint8Array(await fetchBytes(`${BUCKET}/${slot}HS_H09_${y}${mo}${d}_${hm}_B13_FLDK_R20_S${s}.DAT.bz2`, 60_000));
    segs.push(decodeHsd(decodeHead(bz)));
  }
  const grid = localGrid(segs);
  const scene = clearRef(grid);
  const ref = localRef(grid, scene);
  const along = sunriseAz == null ? [] : [0, 30, 80, 150].map((km) => {
    const [la, lo] = destination(SITE.lat, SITE.lon, sunriseAz, km);
    const dx = (lo - SITE.lon) * 111.32 * Math.cos((SITE.lat * Math.PI) / 180), dy = (la - SITE.lat) * 110.57;
    return { km, cloud: cloudAt(grid, ref, dx, dy) };
  });
  const at = new Date(Date.UTC(+y, +mo - 1, +d, +hm.slice(0, 2), +hm.slice(2))).toISOString();
  return {
    png: render(grid, ref),
    data: {
      at, band: "B13 infrared 10.4 µm", spanKm: grid.size * grid.km, clearK: Math.round(scene * 10) / 10,
      overhead: cloudAt(grid, ref, 0, 0, 10), within50km: cloudAt(grid, ref, 0, 0, 50), alongSunrise: along,
    },
  };
}

/** Ciel observé au lever du Soleil : nuages le long de son azimut, et le score qu'ils auraient donné. */
export interface SunriseSky { date: string; at: string; score: number; points: { km: number; low: number; mid: number; high: number }[] }

/** Le lever de soleil qui tombe dans ce créneau de 10 minutes, s'il y en a un. */
export function sunriseInSlot(slotAt: Date): { rise: Date; az: number } | null {
  const rise = riseSet(A.Body.Sun, new Date(slotAt.getTime() - 3 * 3600e3)).rise;
  if (!rise || Math.abs(rise.getTime() - slotAt.getTime()) > 6 * 60e3) return null;
  return { rise, az: horizontal(A.Body.Sun, rise).az };
}

export function satelliteCollector(opts: { onImage: (png: Buffer) => void; onSunrise?: (s: SunriseSky) => void }): Collector<Satellite> {
  let last: string | null = null;
  let lastData: Satellite | null = null;
  return {
    id: "satellite",
    everyMs: 5 * 60e3,
    staleAfterMs: 60 * 60e3,
    run: async ({ now }) => {
      const slot = await latestSlot(now);
      if (slot === last && lastData) return lastData;
      const [, , y, mo, d, hm] = slot.split("/");
      const slotAt = new Date(Date.UTC(+y, +mo - 1, +d, +hm.slice(0, 2), +hm.slice(2)));
      const judged = sunriseInSlot(slotAt);
      const az = judged?.az ?? (() => { const r = riseSet(A.Body.Sun, now).rise; return r ? horizontal(A.Body.Sun, r).az : null; })();
      const s = await satelliteAt(slot, az);
      opts.onImage(s.png);
      if (judged && opts.onSunrise && s.data.alongSunrise.every((p) => p.cloud)) {
        const points = s.data.alongSunrise.map((p) => ({ km: p.km, low: p.cloud!.low, mid: p.cloud!.mid, high: p.cloud!.high }));
        opts.onSunrise({
          date: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(judged.rise),
          at: s.data.at, score: scoreSunrise(points).score, points,
        });
      }
      last = slot;
      lastData = s.data;
      return s.data;
    },
  };
}
