// Banc : rapport entre la houle mesurée près du bord (bouée côtière de Collaroy-Narrabeen, 14 m de fond,
// plage orientée est) et la houle du large (bouée de Sydney), par direction de la houle. Archive AODN sur AWS.
// Usage : npx tsx scripts/nearshore-ratio.mts
import { parquetReadObjects } from "hyparquet";
const AODN = "https://aodn-cloud-optimised.s3.amazonaws.com";
async function keys(site: string) {
  const xml = await (await fetch(`${AODN}/?list-type=2&prefix=wave_buoy_realtime_nonqc.parquet/site_name=${site}/`)).text();
  return [...xml.matchAll(/<Key>([^<]+\.parquet)<\/Key>/g)].map((m) => m[1]);
}
type O = { t: number; hs: number; dir: number | null; tp: number | null; lat?: number; lon?: number; depth?: number };
async function load(site: string): Promise<O[]> {
  const out: O[] = [];
  for (const k of await keys(site)) {
    const buf = await (await fetch(`${AODN}/${k.split("/").map(encodeURIComponent).join("/")}`)).arrayBuffer();
    const rows = await parquetReadObjects({ file: buf, columns: ["TIME", "WSSH", "WHTH", "WPDI", "WPPE", "LATITUDE", "LONGITUDE", "water_depth"] }) as Record<string, unknown>[];
    for (const r of rows) {
      const hs = Number(r.WSSH ?? r.WHTH);
      if (!(hs > 0 && hs < 15)) continue;
      out.push({ t: new Date(r.TIME as string).getTime() / 1000, hs, dir: r.WPDI == null ? null : Number(r.WPDI), tp: r.WPPE == null ? null : Number(r.WPPE), lat: Number(r.LATITUDE), lon: Number(r.LONGITUDE), depth: r.water_depth == null ? undefined : Number(r.water_depth) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
const col = await load("COLLAROY-NARRABEEN");
const syd = await load("Sydney");
console.log("Collaroy", col.length, new Date(col[0].t * 1000).toISOString(), "pos", col.at(-1)!.lat, col.at(-1)!.lon, "depth", col.at(-1)!.depth);
console.log("Sydney", syd.length, new Date(syd[0].t * 1000).toISOString(), "pos", syd.at(-1)!.lat, syd.at(-1)!.lon);
let j = 0;
const pairs: { r: number; dir: number; hs: number; tp: number }[] = [];
for (const c of col) {
  while (j < syd.length - 1 && syd[j + 1].t <= c.t) j++;
  const s = [syd[j], syd[j + 1]].filter(Boolean).sort((a, b) => Math.abs(a.t - c.t) - Math.abs(b.t - c.t))[0];
  if (!s || Math.abs(s.t - c.t) > 1800 || s.dir == null || s.hs < 0.5) continue;
  pairs.push({ r: c.hs / s.hs, dir: s.dir, hs: s.hs, tp: s.tp ?? 0 });
}
const med = (x: number[]) => { const v = [...x].sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
const q = (x: number[], p: number) => { const v = [...x].sort((a, b) => a - b); return v[Math.floor(v.length * p)]; };
console.log("paires", pairs.length, "rapport médian Collaroy/Sydney", med(pairs.map((p) => p.r)).toFixed(2), "IQR", q(pairs.map((p) => p.r), 0.25).toFixed(2), q(pairs.map((p) => p.r), 0.75).toFixed(2));
for (const [a, b, name] of [[0, 67.5, "NNE-ENE"], [67.5, 112.5, "E"], [112.5, 157.5, "SE"], [157.5, 202.5, "S"], [202.5, 360, "SW-N"]] as [number, number, string][]) {
  const p = pairs.filter((x) => x.dir >= a && x.dir < b);
  if (p.length) console.log(name.padEnd(8), "n", String(p.length).padStart(6), "médian", med(p.map((x) => x.r)).toFixed(2), "IQR", q(p.map((x) => x.r), 0.25).toFixed(2), "–", q(p.map((x) => x.r), 0.75).toFixed(2));
}
