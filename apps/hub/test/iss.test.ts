// Juge extérieur : passages calculés par Skyfield (bench/iss_reference.py) sur un TLE réel de l'ISS.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchTle, parseTle, passes } from "../src/sources/iss";

const ref = JSON.parse(readFileSync(new URL("./fixtures/iss-passes-skyfield-2018-07.json", import.meta.url), "utf8"));

describe("passages visibles de l'ISS contre Skyfield", () => {
  const mine = passes(ref.tle, new Date("2018-06-26T12:00:00Z"), 15 * 24, 10);
  it("mêmes passages", () => {
    expect(mine.length).toBe(ref.passes.length);
  });
  it("début et culmination à 20 s près, hauteur maximale à 1° près", () => {
    ref.passes.forEach((p: { start: string; max: string; maxAlt: number }, i: number) => {
      expect(Math.abs(Date.parse(mine[i].start) - Date.parse(p.start)) / 1000).toBeLessThanOrEqual(20);
      expect(Math.abs(Date.parse(mine[i].max) - Date.parse(p.max)) / 1000).toBeLessThanOrEqual(20);
      expect(Math.abs(mine[i].maxAlt - p.maxAlt)).toBeLessThanOrEqual(1);
    });
  });
});

describe("TLE de l'ISS : Celestrak, puis sources de secours", () => {
  const [l1, l2] = ref.tle as [string, string];
  it("lit le format TLE texte et le format JSON { line1, line2 }", () => {
    expect(parseTle(`ISS (ZARYA)\n${l1}\n${l2}\n`)).toEqual([l1, l2]);
    expect(parseTle(JSON.stringify({ satelliteId: 25544, name: "ISS (ZARYA)", line1: l1, line2: l2 }))).toEqual([l1, l2]);
    expect(parseTle("<html>error</html>")).toBeNull();
  });
  it("passe à la source suivante quand Celestrak renvoie une erreur", async () => {
    const asked: string[] = [];
    const tle = await fetchTle(async (u) => {
      asked.push(new URL(u).host);
      if (u.includes("celestrak")) throw new Error("500 Internal Server Error for celestrak.org");
      return `ISS (ZARYA)\n${l1}\n${l2}`;
    });
    expect(tle).toEqual([l1, l2]);
    expect(asked).toEqual(["celestrak.org", "live.ariss.org"]);
  });
  it("donne toutes les causes si aucune source ne répond", async () => {
    await expect(fetchTle(async () => { throw new Error("down"); })).rejects.toThrow("down; down; down");
  });
});
