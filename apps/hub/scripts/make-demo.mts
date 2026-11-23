// Instantané de DÉMONSTRATION pour les tests de bout en bout et les captures : entrées construites
// à la main (marquées comme telles à l'écran), passées dans les vrais calculs de l'app.
// Usage : npx tsx scripts/make-demo.mts <ISO time> <sortie.json>
import { readFileSync, writeFileSync } from "node:fs";
import type { BeachStatus, Buoy, Flights, Iss, Marine, Metar, News, SpaceWeather, Weather } from "@maroubra/core";
import { beach } from "../src/derive/beach";
import { facts, ruleBrief } from "../src/derive/brief";
import { moments } from "../src/derive/moments";
import { scoreSunrise } from "../src/derive/sunrise";
import { loadTide } from "../src/derive/tide";
import { sydneyHour, verify, type FcRow, type ObsRow } from "../src/derive/verify";
import { applyCorrection } from "../src/derive/correct";
import { clearRef, cloudAt, decodeHead, decodeHsd, localGrid, localRef, render } from "../src/sources/himawari";
import { normalize, runwayMode, type RawAc } from "../src/sources/flights";
import { parseFires } from "../src/sources/hazards";
import { parseWarnings } from "../src/sources/weather";

const at = new Date(process.argv[2] ?? "2026-11-14T03:00:00Z");
const out = process.argv[3] ?? "e2e-demo.json";
const nowS = Math.floor(at.getTime() / 1000);
const h0 = nowS - (nowS % 3600);
const hours = Array.from({ length: 60 }, (_, i) => h0 - 24 * 3600 + i * 3600);
const localHour = (t: number) => Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(t * 1000));
const diurnal = (t: number) => Math.sin(((localHour(t) - 9) / 24) * 2 * Math.PI);

const weather: Weather = {
  current: { t: nowS, temp: 24.6, feels: 25.1, humidity: 62, precip: 0, code: 2, cloud: 35, wind: 17, windDir: 65, gust: 28, uv: 9.4, isDay: true, pressure: 1016.4, dewPoint: 16.8, visibility: 24000 },
  hourly: hours.map((t, i) => ({
    t, temp: 21 + 4 * diurnal(t), feels: 21 + 4.5 * diurnal(t), pop: i > 34 && i < 40 ? 60 : 10, precip: i > 35 && i < 39 ? 1.2 : 0, code: i > 35 && i < 39 ? 61 : 2,
    cloud: 35, cloudLow: 10, cloudMid: 30, cloudHigh: 20, wind: 12 + 6 * Math.max(0, diurnal(t)), windDir: localHour(t) >= 11 && localHour(t) <= 18 ? 60 : 280,
    gust: 25, uv: Math.max(0, 10 * diurnal(t)), visibility: 20000, humidity: 60, pressure: 1016 - i * 0.05, dewPoint: 16, isDay: localHour(t) >= 6 && localHour(t) < 20,
  })).filter((x) => x.t >= nowS - 3600),
  daily: Array.from({ length: 10 }, (_, i) => ({ t: h0 + i * 86400, sunrise: h0 + i * 86400 - 8 * 3600 + 42 * 60, sunset: h0 + i * 86400 + 5 * 3600 + 35 * 60, code: [2, 61, 3, 1, 0, 2, 80, 3, 1, 95][i], max: [26, 22, 23, 27, 29, 25, 21, 22, 24, 27][i], min: [18, 17, 16, 18, 19, 18, 16, 15, 17, 19][i], precip: [0, 6, 1, 0, 0, 0.5, 9, 2, 0, 12][i], pop: [10, 70, 30, 5, 0, 20, 80, 40, 5, 85][i], uvMax: 10, windMax: 25, gustMax: 40, windDir: [60, 180, 200, 270, 300, 60, 170, 200, 90, 30][i] })),
  rainPast24h: 0.4,
};
const metar: Metar = { station: "YSSY", t: nowS - 20 * 60, temp: 24, dewpoint: 16, windDir: 50, windKt: 11, gustKt: null, visibility: "6+", qnh: 1016, raw: "YSSY SAMPLE DATA" };
const marine: Marine = { hourly: hours.filter((t) => t >= nowS - 3600).map((t, i) => ({ t, waveHeight: 1.3 + 0.01 * i, waveDir: 140, wavePeriod: 9, swellHeight: 1.1 + 0.008 * i, swellDir: 150, swellPeriod: 11.5, windWaveHeight: 0.4, sst: 20.4 })) };
const buoy: Buoy = { station: "Sydney Waverider (MHL)", lat: -33.75, lon: 151.4, latest: { t: nowS - 2 * 3600, hs: 1.45, hmax: 2.6, tp: 11.8, dir: 148 },
  series: Array.from({ length: 44 }, (_, i) => ({ t: nowS - (46 - i) * 3600, hs: 1.2 + 0.4 * Math.sin(i / 7), hmax: 2.3, tp: 11 + Math.sin(i / 9), dir: 150 })) };
const nearBuoy: Buoy = { station: "Collaroy-Narrabeen nearshore buoy (IMOS)", lat: -33.73, lon: 151.31, latest: { t: nowS - 3600, hs: 0.86, hmax: 1.5, tp: 11.5, dir: 128 },
  series: buoy.series.map((o) => ({ ...o, hs: o.hs! * 0.6, dir: 128 })) };
const raw: RawAc[] = [
  { hex: "7c6b2d", flight: "QFA432", r: "VH-VZA", t: "B738", desc: "BOEING 737-800", ownOp: "QANTAS AIRWAYS", year: "2003", category: "A3", type: "adsb_icao", squawk: "3012", alt_baro: 2100, gs: 165, track: 338, baro_rate: -640, lat: -34.012, lon: 151.205, seen_pos: 1 },
  { hex: "7c4920", flight: "VOZ821", r: "VH-YIA", t: "B738", desc: "BOEING 737-800", category: "A3", type: "adsb_icao", squawk: "4433", alt_baro: 7800, gs: 290, track: 160, baro_rate: 1800, lat: -33.99, lon: 151.21, seen_pos: 1 },
  { hex: "c81e2f", flight: "ANZ103", t: "B789", desc: "BOEING 787-9 Dreamliner", category: "A5", type: "adsb_icao", squawk: "3115", alt_baro: 9000, gs: 300, track: 255, baro_rate: -900, lat: -33.93, lon: 151.42, seen_pos: 1 },
  { hex: "7c0001", flight: "QFA1", r: "VH-OQA", t: "A388", desc: "AIRBUS A-380-800", ownOp: "QANTAS AIRWAYS", year: "2008", category: "A5", type: "adsb_icao", squawk: "3301", alt_baro: 5200, gs: 250, track: 95, baro_rate: 1500, lat: -33.951, lon: 151.215, seen_pos: 1 },
  { hex: "7c81b5", flight: "RSCU201", t: "A139", desc: "AGUSTAWESTLAND AW-139", category: "A7", type: "mlat", squawk: "1000", alt_baro: 900, gs: 110, track: 20, lat: -33.97, lon: 151.27, seen_pos: 2 },
  { hex: "7c533a", flight: "JST512", r: "VH-OFA", t: "A321", desc: "AIRBUS A-321neo", category: "A3", type: "adsb_icao", squawk: "7700", emergency: "general", alt_baro: 12000, gs: 320, track: 200, baro_rate: -1200, lat: -33.80, lon: 151.30, seen_pos: 1 },
  { hex: "7c7a3e", flight: "RXA6516", r: "VH-NRX", t: "SF34", desc: "SAAB 340", category: "A2", type: "adsb_icao", squawk: "3420", alt_baro: 4300, gs: 180, track: 300, baro_rate: -700, lat: -34.05, lon: 151.33, seen_pos: 1 },
  { hex: "7c3f11", flight: "VHSTR", r: "VH-STR", t: "C172", desc: "CESSNA 172", category: "A1", type: "adsb_icao", squawk: "1200", alt_baro: 1500, gs: 95, track: 15, lat: -34.08, lon: 151.15, seen_pos: 3 },
];
const SYD = { iata: "SYD", icao: "YSSY", name: "Sydney Kingsford Smith", location: "Sydney", lat: -33.9461, lon: 151.1772 };
const ap = (iata: string, icao: string, name: string, location: string, lat: number, lon: number) => ({ iata, icao, name, location, lat, lon });
const MEL = ap("MEL", "YMML", "Melbourne", "Melbourne", -37.6733, 144.8433), BNE = ap("BNE", "YBBN", "Brisbane", "Brisbane", -27.3842, 153.1175);
const DXB = ap("DXB", "OMDB", "Dubai International", "Dubai", 25.2528, 55.3644), LHR = ap("LHR", "EGLL", "Heathrow", "London", 51.47, -0.4543);
const AKL = ap("AKL", "NZAA", "Auckland", "Auckland", -37.0082, 174.785), OOL = ap("OOL", "YBCG", "Gold Coast", "Gold Coast", -28.1644, 153.5047);
const WGA = ap("WGA", "YSWG", "Wagga Wagga", "Wagga Wagga", -35.1653, 147.4664);
const route = (callsign: string, list: typeof SYD[]) => [callsign, { callsign, airport_codes: list.map((a) => a.icao).join("-"), _airport_codes_iata: list.map((a) => a.iata).join("-"), plausible: true, _airports: list }] as const;
const routes = new Map([
  route("QFA432", [MEL, SYD]), route("QFA1", [SYD, DXB, LHR]), route("VOZ821", [SYD, BNE]),
  route("ANZ103", [AKL, SYD]), route("JST512", [OOL, SYD]), route("RXA6516", [WGA, SYD]),
]);
const trails = new Map(raw.map((r) => [r.hex, Array.from({ length: 12 }, (_, i) => [r.lat! - Math.cos(((r.track ?? 0) * Math.PI) / 180) * 0.004 * (12 - i), r.lon! - Math.sin(((r.track ?? 0) * Math.PI) / 180) * 0.005 * (12 - i)] as [number, number])]));
const aircraft = normalize(raw, routes as never, trails, at.getTime());
const flights: Flights = { aircraft, runway: runwayMode(aircraft), curfew: false, seenToday: 214, source: "adsb.fi" };
const fires = parseFires(JSON.parse(readFileSync(new URL("../test/fixtures/rfs-majorincidents-2020-10-10.json", import.meta.url), "utf8")), weather.current.windDir);
const space: SpaceWeather = { kpNow: 3.3, kpMax24h: 4, forecastMax: 5, forecastAt: new Date(at.getTime() + 9 * 3600e3).toISOString(), aurora: "none" };
const iss: Iss = { tleEpoch: at.toISOString(), passes: [
  { start: new Date(at.getTime() + 6.2 * 3600e3).toISOString(), max: new Date(at.getTime() + 6.25 * 3600e3).toISOString(), end: new Date(at.getTime() + 6.3 * 3600e3).toISOString(), maxAlt: 64, startAz: 300, endAz: 120, durationMin: 6 },
  { start: new Date(at.getTime() + 30.1 * 3600e3).toISOString(), max: new Date(at.getTime() + 30.13 * 3600e3).toISOString(), end: new Date(at.getTime() + 30.17 * 3600e3).toISOString(), maxAlt: 22, startAz: 250, endAz: 170, durationMin: 4 },
] };
const air = { current: { t: nowS, pm25: 6.2, pm10: 13, aqi: 26, uv: 9.4 }, hourly: hours.map((t) => ({ t, pm25: 6, aqi: 25 })), modelled: true as const };
const news: News = { triagedBy: "keywords", items: Array.from({ length: 6 }, (_, i) => ({
  id: `sample-${i}`, title: `Sample local headline ${i + 1} (test data, not real news)`, link: "https://example.com/", source: "Sample source",
  published: new Date(at.getTime() - (i * 5 + 1) * 3600e3).toISOString(), summary: "Placeholder summary used only to test the layout.", topic: ["beach", "council", "community", "events", "environment", "transport"][i], local: true,
})) };
const tide = loadTide(new URL("../../web/public", import.meta.url).pathname);
// Statut officiel construit à la main : ouverte le jour, fermée (requin) dans l'instantané de nuit, pour voir les deux états.
const reportAt = new Date(Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(at) + "T06:52:00+11:00")).toISOString();
const closedDemo = localHour(nowS) >= 20;
const beachStatus: BeachStatus = {
  status: closedDemo ? "closed" : "open", reason: closedDemo ? "Shark sighting" : null,
  lifeguard: closedDemo
    ? { summary: "Beach closed", description: "Shark sighted off the north end mid afternoon. Beach closed for the rest of the day.", rips: "Be cautious", bluebottles: "None sighted", waterTemp: "20 C", waveHeight: "1m", at: reportAt, today: true, photo: null }
    : { summary: "Rough conditions", description: "Moderate south-east swell with a strong rip at the north end. Swim between the flags.", rips: "Be cautious", bluebottles: "Some sighted", waterTemp: "20 C", waveHeight: "1-1.5m", at: reportAt, today: true, photo: null },
  patrol: { today: true, start: "07:00", end: "19:00" }, hazard: 6,
  water: { forecast: "Unlikely", latest: "Good", at: reportAt }, errors: [],
};
const b = beach(weather, marine, buoy, tide, at.getTime(), beachStatus);
const s = scoreSunrise([{ low: 10, mid: 45, high: 30 }, { low: 10, mid: 40, high: 40 }, { low: 5, mid: 15, high: 10 }, { low: 0, mid: 5, high: 0 }]);
const sunrise = { date: "2026-11-15", time: "2026-11-14T18:42:00Z", ...s };
const ms = moments({ weather, beach: b, sunrise, iss, space, fires, flights }, at);
const brief = { text: ruleBrief(facts(weather, b, "low tide at 18:40", ms, at)), at: at.toISOString(), by: "rules" };
// Track record vivant : un mois d'archive SYNTHÉTIQUE passé dans le vrai calcul (biais diurne connu).
const fc: FcRow[] = [], obs: ObsRow[] = [], fcB: FcRow[] = [], obsB: ObsRow[] = [];
const T0 = nowS - (nowS % 3600) - 30 * 86400;
for (let i = 0; i < 30 * 24; i++) {
  const issued = T0 + i * 3600;
  const truthAt = (t: number) => 20 + 4 * Math.sin(((sydneyHour(t) - 9) / 24) * 2 * Math.PI);
  for (let lead = 0; lead < 49; lead++) {
    const valid = issued + lead * 3600;
    const h = sydneyHour(valid);
    fc.push({ issued, valid, temp: truthAt(valid) + (h >= 12 && h <= 17 ? 1.6 : h <= 5 ? -0.8 : 0) + Math.sin(valid / 5000 + lead) * (0.6 + lead / 60), wind: 18 + 6 * Math.sin(valid / 20000) + Math.cos(valid / 7000 + lead) * 3, pop: (valid / 3600) % 31 < 3 ? 70 : 10 });
    fcB.push({ issued, valid, hs: 1.4 + 0.5 * Math.sin(valid / 90000) + Math.sin(valid / 13000 + lead) * 0.2 });
  }
  obs.push({ t: issued, temp: Math.round(truthAt(issued)), windKmh: 15 + 6 * Math.sin(issued / 20000), rain: (issued / 3600) % 31 < 2 });
  obsB.push({ t: issued, hs: 1.4 + 0.5 * Math.sin(issued / 90000) });
}
const overhead = Array.from({ length: 41 }, (_, i) => ({ hex: `d${i}`, callsign: null, at: new Date((T0 + i * 60000) * 1000).toISOString(), inMin: 2 + (i % 4), minKm: i % 9 === 0 ? 2.4 : 0.3 + (i % 5) * 0.2, hit: i % 9 !== 0 }));
const days = Array.from({ length: 6 }, (_, i) => new Date((T0 + (24 + i) * 86400) * 1000).toISOString().slice(0, 10));
const verification = verify({ fcAirport: [], fcMaroubra: fc, fcBuoy: fcB, fcMarine: [], metar: obs, buoy: obsB, overhead, sunrise: days.map((d, i) => ({ date: d, score: [7.5, 3, 5.5, 8, 2, 6][i] })) }, nowS);
const weatherShown = applyCorrection(weather, verification, at.getTime());

// Image satellite : le vrai fichier Himawari du 21/11/2026 12:00 UTC (fixture des tests), horodaté à l'heure de la démo.
const seg = decodeHsd(decodeHead(readFileSync(new URL("../test/fixtures/himawari-b13-s0910-20261121-1200-head.bz2", import.meta.url))));
const grid = localGrid([seg]);
const scene = clearRef(grid), ref = localRef(grid, scene);
writeFileSync(`${out}.png`, render(grid, ref));
const satellite = { at: new Date(at.getTime() - 20 * 60e3).toISOString(), band: "B13 infrared 10.4 µm", spanKm: 300, clearK: scene, overhead: cloudAt(grid, ref, 0, 0, 10), within50km: cloudAt(grid, ref, 0, 0, 50), alongSunrise: [] };

const warnings = parseWarnings(readFileSync(new URL("../test/fixtures/bom-warnings-nsw-2026-11-21.xml", import.meta.url), "utf8"));
// Surfeurs à l'eau : une lecture du matin même (exemple), pour voir la ligne dans la carte des caméras.
const surfAt = new Date(at.getTime() - 25 * 60e3).toISOString();
const surf = { at: surfAt, crowd: "few", cams: [{ id: "north", crowd: "few", note: "about four sitting off the north rocks" }, { id: "south", crowd: "none", note: "empty line-up, small messy waves" }],
  budget: { day: surfAt.slice(0, 10), looks: 6, cap: 10, inputTokens: 16800, outputTokens: 2100 } };
writeFileSync(out, JSON.stringify({ surf, "buoy-near": nearBuoy, satellite, verify: verification, weather: weatherShown, warnings, metar, marine, buoy, beachStatus, flights, fires, air, space, iss, sunrise, news, beach: b, moments: ms, brief }));
console.log(out, "beach", b.score, b.label, "moments", ms.length, "fires", fires.nearby.length, "brief:", brief.text);
