// Banc de la prévision immédiate par satellite : télécharge le début du segment 9 de la bande 13 pour
// chaque créneau de 10 minutes d'une période, et garde la grille locale de 300 km (Tb × 100, Uint16).
// Usage : npx tsx scripts/fetch-himawari-grids.mts 2026-11-14T00:00Z 2026-11-21T12:00Z <dossier>
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { decodeHead, decodeHsd, localGrid, slotFile } from "../src/sources/himawari";
import { fetchBytes } from "../src/http";

const [from, to, dir] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const slots: Date[] = [];
for (let t = Date.parse(from); t <= Date.parse(to); t += 10 * 60e3) slots.push(new Date(t));
let done = 0, failed = 0;
async function one(t: Date) {
  const iso = t.toISOString();
  const name = `${dir}/${iso.slice(0, 16).replace(/[-:]/g, "")}.u16`;
  if (existsSync(name)) { done++; return; }
  const slot = `AHI-L1b-FLDK/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(11, 13)}${iso.slice(14, 16)}/`;
  const url = slotFile(slot, "0910").url;
  try {
    let head: Uint8Array;
    try { head = decodeHead(new Uint8Array(await fetchBytes(url, 60_000, { Range: "bytes=0-1199999" })), undefined, false); }
    catch { head = decodeHead(new Uint8Array(await fetchBytes(url, 120_000))); }
    const g = localGrid([decodeHsd(head)]);
    const out = new Uint16Array(g.tb.length);
    for (let i = 0; i < g.tb.length; i++) out[i] = Number.isFinite(g.tb[i]) ? Math.round(g.tb[i] * 100) : 0;
    writeFileSync(name, Buffer.from(out.buffer));
    done++;
  } catch (err) {
    failed++;
    console.error(iso, String(err).slice(0, 120));
  }
}
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (i < slots.length) { await one(slots[i++]); if ((done + failed) % 50 === 0) console.log(done, failed, "/", slots.length); } }));
console.log("done", done, "failed", failed);
