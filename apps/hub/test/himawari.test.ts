import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bz2Streams, clearRef, cloudAt, decodeHead, decodeHsd, geosPixel, localGrid, localRef, render, sunriseInSlot } from "../src/sources/himawari";

// Début réel du segment 9 de la bande 13 de Himawari-9, 21/11/2026 12:00 UTC (archive NOAA sur AWS),
// réduit aux deux premiers flux bzip2 : exactement ce que le hub décode en production.
const bz = readFileSync(new URL("./fixtures/himawari-b13-s0910-20261121-1200-head.bz2", import.meta.url));

describe("Himawari-9, bande 13 (fichier réel)", () => {
  const seg = decodeHsd(decodeHead(bz));
  it("lit l'en-tête HSD", () => {
    expect(bz2Streams(bz)).toHaveLength(2);
    expect(seg.cols).toBe(5500);
    expect(seg.firstLine).toBe(4401);
    expect(seg.lines).toBeGreaterThanOrEqual(130);
    expect(seg.subLon).toBeCloseTo(140.7, 5);
  });
  it("place Maroubra à la ligne 4459 du disque, comme le lecteur de référence (Satpy) dans le banc", () => {
    const p = geosPixel(-33.9496, 151.2577, seg)!;
    expect(Math.round(p.line)).toBe(4459);
    expect(p.col).toBeGreaterThan(3200);
    expect(p.col).toBeLessThan(3240);
  });
  it("donne des températures de brillance plausibles : mer claire près de la surface de l'eau (≈ 20 °C)", () => {
    const g = localGrid([seg]);
    const finite = [...g.tb].filter(Number.isFinite);
    expect(finite.length).toBe(g.size * g.size);
    const ref = clearRef(g);
    expect(ref).toBeGreaterThan(285);
    expect(ref).toBeLessThan(297);
    expect(Math.min(...finite)).toBeGreaterThan(200);
    const local = localRef(g, ref);
    const c = cloudAt(g, local, 0, 0, 10)!;
    expect(c.total).toBe(c.low + c.mid + c.high);
    const png = render(g, local);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe("créneau du lever de soleil", () => {
  it("reconnaît le créneau de 10 minutes qui contient le lever", () => {
    // Lever à Maroubra le 22/11/2026 vers 05:39 AEDT, soit 18:39 UTC le 21.
    const hit = ["1830", "1840"].map((hm) => sunriseInSlot(new Date(`2026-11-21T${hm.slice(0, 2)}:${hm.slice(2)}:00Z`)));
    expect(hit.filter(Boolean)).toHaveLength(1);
    expect(hit.find(Boolean)!.az).toBeGreaterThan(100);
    expect(hit.find(Boolean)!.az).toBeLessThan(125);
    expect(sunriseInSlot(new Date("2026-11-21T12:00:00Z"))).toBeNull();
  });
});
