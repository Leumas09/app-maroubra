import { describe, expect, it } from "vitest";
import { computeSky } from "../src/lib/sky-model";
import { skyEvents, visibility } from "../src/lib/sky-events";

const hour = (t: number, low: number, mid = 0, high = 0, precip = 0) => ({ t, temp: 20, feels: 20, pop: 0, precip, code: 1, cloud: low, cloudLow: low, cloudMid: mid, cloudHigh: high, wind: 10, windDir: 0, gust: 10, uv: 0, visibility: 20000, humidity: 60 });

describe("score de visibilité", () => {
  const t = new Date("2026-12-14T13:00:00Z"); // minuit à Sydney
  it("ciel dégagé : 10 pour un astre brillant assez haut ; nuages bas : presque rien", () => {
    expect(visibility(t, 45, false, [hour(t.getTime() / 1000, 0)]).score).toBe(10);
    expect(visibility(t, 45, false, [hour(t.getTime() / 1000, 90)]).score).toBeLessThan(2);
    expect(visibility(t, 5, false, [hour(t.getTime() / 1000, 0)]).score).toBe(5); // bas sur l'horizon
  });
  it("sans prévision de nuages à cette heure : score inconnu", () => {
    expect(visibility(t, 45, false, null).score).toBeNull();
    expect(visibility(t, 45, false, [hour(t.getTime() / 1000 - 6 * 3600, 0)]).score).toBeNull();
  });
});

describe("ce soir, le meilleur à voir", () => {
  it("nuit des Géminides 2026 : l'essaim apparaît, avec un taux et une direction", () => {
    const now = new Date("2026-12-14T09:30:00Z"); // 20:30 à Sydney
    const ev = skyEvents(now, computeSky(now), null, null);
    const gem = ev.find((e) => e.kind === "meteors" && e.title.startsWith("Geminids"));
    expect(gem).toBeDefined();
    expect(gem!.detail).toMatch(/Peak tonight/);
    expect(gem!.alt).toBeGreaterThan(10);
  });
  it("ignore une Station spatiale trop basse et garde un passage haut", () => {
    const now = new Date("2026-12-14T09:30:00Z");
    const iss = { tleEpoch: "", passes: [
      { start: "2026-12-14T10:00:00Z", max: "2026-12-14T10:03:00Z", end: "2026-12-14T10:06:00Z", maxAlt: 12, startAz: 300, endAz: 120, durationMin: 6 },
      { start: "2026-12-14T11:30:00Z", max: "2026-12-14T11:33:00Z", end: "2026-12-14T11:36:00Z", maxAlt: 70, startAz: 250, endAz: 60, durationMin: 6 },
    ] };
    const ev = skyEvents(now, computeSky(now), iss, null).filter((e) => e.kind === "iss");
    expect(ev).toHaveLength(1);
    expect(ev[0].alt).toBe(70);
  });
});
