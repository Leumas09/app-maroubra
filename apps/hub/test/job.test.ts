import { describe, expect, it } from "vitest";
import { memoryArchive } from "../src/archive";
import type { Collector } from "../src/collector";
import { ARCHIVE_SOURCES, archiveOnce } from "../src/job";

const now = new Date("2026-11-26T01:05:00Z");
const t0 = Math.floor(now.getTime() / 1000);
const src = (id: string, data: unknown): Collector => ({ id, everyMs: 60e3, staleAfterMs: 3600e3, run: async () => data });

describe("relevé horaire de la tâche planifiée", () => {
  it("lit exactement les sources de l'archive horaire, sans modèle", () => {
    expect(ARCHIVE_SOURCES.map((c) => c.id).sort()).toEqual(["buoy", "fc-airport", "fc-buoy", "marine", "metar", "sunrise", "weather"]);
  });

  it("écrit les prévisions et observations de l'heure, et signale les sources en échec", async () => {
    const archive = memoryArchive();
    const run = await archiveOnce(archive, [
      src("fc-airport", { hourly: [{ t: t0 + 3600, temp: 24, wind: 12, gust: 20, precip: 0, pop: 10 }] }),
      src("metar", { t: t0 - 600, temp: 23, windKt: 8, windDir: 40, rain: false, raw: "YSSY 260030Z 04008KT CAVOK 23/15 Q1015" }),
      { id: "marine", everyMs: 60e3, staleAfterMs: 3600e3, run: async () => { throw new Error("503 Service Unavailable"); } },
    ], now);
    expect(run.ok.sort()).toEqual(["fc-airport", "metar"]);
    expect(run.failed).toEqual([{ id: "marine", error: "503 Service Unavailable" }]);
    expect(run.rows).toBe(2);
    const keys = [...archive.rows.keys()];
    expect(keys).toContain(`fc-yssy-20261126|2026112601-${t0 + 3600}`);
    expect(keys).toContain(`obs-yssy-202611|${t0 - 600}`);
  });

  it("rien à écrire si toutes les sources échouent", async () => {
    const fail: Collector = { id: "weather", everyMs: 60e3, staleAfterMs: 3600e3, run: async () => { throw new Error("timeout"); } };
    const run = await archiveOnce(memoryArchive(), [fail], now);
    expect(run.rows).toBe(0);
    expect(run.failed.length).toBe(1);
  });
});
