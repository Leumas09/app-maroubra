import { describe, expect, it } from "vitest";
import type { Aircraft, Verification, Weather } from "@maroubra/core";
import { archiveHour, archiveReader, memoryArchive } from "../src/archive";
import { applyCorrection } from "../src/derive/correct";
import {
  DecayingBias, issuedToUnix, nearest, pairs, rainScore, replay, spearman, sunriseScore, sydneyHour, verify, type FcRow, type ObsRow,
} from "../src/derive/verify";
import { OverheadJudge, segmentMinKm } from "../src/sources/flights";
import { metarRain, parseMetar } from "../src/sources/weather";
import { Store } from "../src/store";

// Un mois synthétique : la « vérité » suit un cycle diurne, le modèle a un biais connu
// (+2 °C l'après-midi, -1 °C la nuit) et un bruit déterministe.
const T0 = Date.UTC(2026, 9, 20) / 1000; // 20/10/2026 00:00 UTC
const truth = (t: number) => 20 + 4 * Math.sin(((sydneyHour(t) - 9) / 24) * 2 * Math.PI);
const noise = (t: number, lead: number) => Math.sin(t / 3700 + lead * 1.3) * 0.6;
const modelBias = (t: number) => { const h = sydneyHour(t); return h >= 12 && h <= 17 ? 2 : h <= 5 ? -1 : 0; };

function month(days = 30): { fc: FcRow[]; obs: ObsRow[] } {
  const fc: FcRow[] = [];
  const obs: ObsRow[] = [];
  for (let i = 0; i < days * 24; i++) {
    const issued = T0 + i * 3600;
    for (let lead = 0; lead < 49; lead += 1) {
      const valid = issued + lead * 3600;
      fc.push({ issued, valid, temp: truth(valid) + modelBias(valid) + noise(valid, lead), wind: 20 + 3 * Math.sin(valid / 9000), pop: (valid / 3600) % 24 === 3 ? 80 : 5 });
    }
    obs.push({ t: issued, temp: Math.round(truth(issued)), windKmh: 15 + 3 * Math.sin(issued / 9000), rain: (issued / 3600) % 24 === 3 });
  }
  return { fc, obs };
}

describe("appariement prévision et observation", () => {
  it("lit l'heure d'émission archivée", () => {
    expect(issuedToUnix("2026110305")).toBe(Date.UTC(2026, 10, 3, 5) / 1000);
  });
  it("trouve l'observation la plus proche, dans la tolérance seulement", () => {
    const obs = [{ t: 1000 }, { t: 2800 }, { t: 4600 }];
    expect(nearest(obs, 2700)?.t).toBe(2800);
    expect(nearest(obs, 10_000)).toBeNull();
  });
});

describe("correction apprise en ligne, sans fuite du futur", () => {
  const { fc, obs } = month();
  const ps = pairs(fc, obs, "temp", "temp");

  it("ne corrige rien tant qu'aucune observation n'est connue à l'émission", () => {
    const { scored } = replay(ps);
    const first = scored.filter((p) => p.issued === T0);
    expect(first.length).toBeGreaterThan(0);
    for (const p of first) expect(p.corrected).toBe(p.fc);
  });

  it("apprend le biais diurne du modèle et réduit l'erreur", () => {
    const { scored, model } = replay(ps);
    const late = scored.filter((p) => p.valid > T0 + 10 * 86400);
    const raw = late.reduce((s, p) => s + Math.abs(p.fc - p.obs), 0) / late.length;
    const cor = late.reduce((s, p) => s + Math.abs(p.corrected - p.obs), 0) / late.length;
    expect(cor).toBeLessThan(raw * 0.7);
    // L'après-midi (15 h à Sydney), biais appris proche de +2 °C, à 6-12 h d'échéance.
    const t15 = [...Array(48)].map((_, i) => T0 + 25 * 86400 + i * 3600).find((t) => sydneyHour(t) === 15)!;
    expect(model.bias(8, t15, t15)).toBeGreaterThan(1.5);
    expect(model.bias(8, t15, t15)).toBeLessThan(2.5);
  });

  it("le biais oublie le passé lointain (décroissance) et se méfie du peu de données", () => {
    const m = new DecayingBias(86400, 4);
    const t = T0;
    m.learn({ issued: t - 3600, valid: t, lead: 1, fc: 25, obs: 20 });
    expect(m.bias(1, t, t)).toBeCloseTo(0.5, 5); // une erreur de 5, a priori de poids 4, lissée sur 3 heures (1-2-1)
    expect(Math.abs(m.bias(1, t, t + 20 * 86400))).toBeLessThan(0.01);
  });

  it("le Track record vivant n'active la correction que si elle bat le modèle brut", () => {
    const { fc, obs } = month();
    const v = verify({ fcAirport: [], fcMaroubra: fc, fcBuoy: [], fcMarine: [], metar: obs, buoy: [], overhead: [], sunrise: [] }, T0 + 30 * 86400);
    const temp = v.scores.find((s) => s.key === "temp")!;
    expect(temp.status).not.toBe("collecting");
    expect(v.correction.temp.on).toBe(true);
    expect(temp.leads?.length).toBe(4);
    // Le vent a un biais constant de +5 km/h : appris aussi.
    expect(v.correction.wind.on).toBe(true);
    // Sans données : en apprentissage, rien d'appliqué.
    const empty = verify({ fcAirport: [], fcMaroubra: [], fcBuoy: [], fcMarine: [], metar: [], buoy: [], overhead: [], sunrise: [] }, T0);
    expect(empty.correction.temp.on).toBe(false);
    expect(empty.scores.every((s) => s.status === (s.key === "sunrise" ? "unjudged" : "collecting"))).toBe(true);
  });

  it("applique la correction à l'écran en gardant les valeurs brutes", () => {
    const { fc, obs } = month();
    const now = T0 + 30 * 86400;
    const v = verify({ fcAirport: [], fcMaroubra: fc, fcBuoy: [], fcMarine: [], metar: obs, buoy: [], overhead: [], sunrise: [] }, now);
    const hours = Array.from({ length: 30 }, (_, i) => now + i * 3600);
    const w = { current: { t: now, temp: 22, feels: 22 }, rainPast24h: 0, hourly: hours.map((t) => ({ t, temp: truth(t) + modelBias(t), feels: truth(t) + modelBias(t), wind: 25 })),
      daily: [{ t: now, max: 30, min: 15 }] } as unknown as Weather;
    const c = applyCorrection(w, v, now * 1000);
    expect(c.corrected?.temp).toBe(true);
    const h15 = c.hourly.find((h) => sydneyHour(h.t) === 15)!;
    expect(h15.tempRaw).toBeDefined();
    expect(Math.abs(h15.temp - truth(h15.t))).toBeLessThan(Math.abs(h15.tempRaw! - truth(h15.t)));
    expect(applyCorrection(w, null, now * 1000)).toBe(w);
  });
});

describe("pluie et METAR", () => {
  it("reconnaît la pluie présente ou récente, pas les averses au voisinage", () => {
    expect(metarRain("METAR YSSY 211200Z AUTO 02007KT 9999 // NCD 24/18 Q1016")).toBe(false);
    expect(metarRain("METAR YSSY 211200Z 18015KT 5000 -SHRA BKN020 18/16 Q1012")).toBe(true);
    expect(metarRain("METAR YSSY 211200Z 18015KT 9999 VCSH SCT030 18/16 Q1012")).toBe(false);
    expect(metarRain("METAR YSSY 211200Z 18015KT 9999 FEW030 18/16 Q1012 RERA")).toBe(true);
    expect(metarRain("METAR YSSY 211200Z 18015KT 9999 FEW030 18/16 Q1012 RMK RA")).toBe(false);
  });
  it("garde les observations des 3 dernières heures", () => {
    const m = parseMetar([
      { icaoId: "YSSY", obsTime: 100, temp: 20, wspd: 5, wdir: 10, rawOb: "METAR YSSY 18015KT -RA 20/18 Q1012" },
      { icaoId: "YSSY", obsTime: 1900, temp: 21, wspd: 6, wdir: 20, rawOb: "METAR YSSY 18015KT 21/18 Q1012" },
    ]);
    expect(m.t).toBe(1900);
    expect(m.recent?.map((r) => r.rain)).toEqual([false, true]);
  });
  it("score de Brier : une prévision qui sait quand il pleut bat la climatologie", () => {
    const { fc, obs } = month();
    const s = rainScore(fc, obs, T0 + 30 * 86400);
    expect(s.n).toBeGreaterThan(1000);
    expect(s.status).toBe("met");
  });
});

describe("annonces de survol jugées sur la trace réelle", () => {
  const home = { lat: -33.9496, lon: 151.2577 };
  const ac = (hex: string, lat: number, lon: number, overhead: Aircraft["overhead"]): Aircraft => ({
    hex, callsign: hex, reg: null, type: null, altFt: 3000, onGround: false, speedKt: 200, track: 270, vrate: 0, lat, lon, distKm: 5, bearing: 90,
    military: false, interesting: false, rare: null, emergency: null, route: null, overhead, trail: [],
  }) as unknown as Aircraft;
  it("mesure le passage au plus près sur le segment, pas seulement aux points échantillonnés", () => {
    expect(segmentMinKm([home.lat, home.lon + 0.02], [home.lat, home.lon - 0.02])).toBeLessThan(0.01);
  });
  it("compte un passage confirmé et un raté", () => {
    const j = new OverheadJudge(0);
    const t = 1_000_000;
    // A passe pile au-dessus, B passe à 3 km au nord.
    j.update([ac("A", home.lat, home.lon + 0.05, { inMin: 2, closestKm: 0.2 }), ac("B", home.lat + 0.027, home.lon + 0.05, { inMin: 2, closestKm: 0.5 })], t);
    for (let k = 1; k <= 30; k++) {
      const lon = home.lon + 0.05 - k * 0.004;
      j.update([ac("A", home.lat, lon, null), ac("B", home.lat + 0.027, lon, null)], t + k * 10e3);
    }
    const out = j.update([], t + 6 * 60e3);
    expect(j.announced).toBe(2);
    expect(j.hits).toBe(1);
    expect(out.find((o) => o.hex === "B")?.hit).toBe(false);
  });
});

describe("lever de soleil sans juge", () => {
  it("corrélation de rang", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });
  it("reste visible dans le Track record, marqué « non jugé »", () => {
    const fc = Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, score: i }));
    const s = sunriseScore(fc);
    expect(s.status).toBe("unjudged");
    expect(s.result).toBe("Not judged");
  });
});

describe("archive : écrire puis relire", () => {
  it("garde les prévisions brutes et toutes les observations récentes", async () => {
    const store = new Store();
    const now = new Date("2026-11-21T03:05:00Z");
    const t = Math.floor(now.getTime() / 1000 / 3600) * 3600;
    store.success("weather", { hourly: [{ t, temp: 25, tempRaw: 27, wind: 10, windRaw: 12, windDir: 90, gust: 20, precip: 0, pop: 10, cloud: 20 }], daily: [], current: {} });
    store.success("metar", { t, temp: 24, windKt: 10, raw: "x", recent: [{ t, temp: 24, windKt: 10, windDir: 90, rain: false, raw: "a" }, { t: t - 1800, temp: 23, windKt: 8, windDir: 90, rain: true, raw: "b" }] });
    store.success("sunrise", { date: "2026-11-22", time: "2026-11-21T18:40:00Z", score: 7.5, label: "x", why: "y" });
    const mem = memoryArchive();
    expect(await archiveHour(mem, store, now)).toBe(4);
    const d = await archiveReader(mem)(now);
    expect(d.fcMaroubra[0].temp).toBe(27);
    expect(d.fcMaroubra[0].issued).toBe(Date.UTC(2026, 10, 21, 3) / 1000);
    expect(d.metar.map((o) => o.rain).sort()).toEqual([false, true]);
    expect(d.metar[0].windKmh).toBeCloseTo(18.52, 1);
    expect(d.sunrise).toEqual([{ date: "2026-11-22", score: 7.5 }]);
    const v: Verification = verify(d, now.getTime() / 1000);
    expect(v.scores).toHaveLength(6);
  });
});

describe("corrections de la relecture", () => {
  it("une hauteur de vague absente (-1 dans les anciennes lignes) n'est pas jugée comme 0 m d'erreur… ni -1 m", async () => {
    const mem = memoryArchive();
    const t = Date.UTC(2026, 10, 20, 0) / 1000;
    await mem.upsert({ partitionKey: "obs-buoy-202611", rowKey: String(t), hs: -1, tp: -1, dir: -1 });
    await mem.upsert({ partitionKey: "fc-marine-20261119", rowKey: `2026111922-${t}`, issued: "2026111922", valid: t, hs: -1 });
    const d = await archiveReader(mem)(new Date(t * 1000 + 3600e3));
    expect(d.buoy[0].hs).toBeNull();
    expect(d.fcMarine[0].hs).toBeNull();
  });
  it("« since » est le début de la fenêtre, pas le jour le plus récent", () => {
    const { fc, obs } = month(10);
    const v = verify({ fcAirport: [], fcMaroubra: [...fc].reverse(), fcBuoy: [], fcMarine: [], metar: obs, buoy: [], overhead: [], sunrise: [] }, T0 + 10 * 86400);
    const rain = v.scores.find((s) => s.key === "rain")!;
    expect(Date.parse(rain.since!) / 1000).toBeLessThan(T0 + 86400);
  });
  it("une prévision non rafraîchie depuis plus de 90 min n'est pas réarchivée comme neuve", async () => {
    const store = new Store();
    const old = new Date("2026-11-21T00:00:00Z");
    store.success("weather", { hourly: [{ t: 1, temp: 20, wind: 1, windDir: 1, gust: 1, precip: 0, pop: 0, cloud: 0 }], daily: [], current: {} }, old);
    const mem = memoryArchive();
    expect(await archiveHour(mem, store, new Date("2026-11-21T01:00:00Z"))).toBe(1);
    expect(await archiveHour(mem, store, new Date("2026-11-21T03:00:00Z"))).toBe(0);
  });
});
