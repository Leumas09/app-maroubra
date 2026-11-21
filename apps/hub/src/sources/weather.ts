// Prévisions Open-Meteo (meilleure combinaison de modèles pour Sydney, dont BOM ACCESS-G),
// et observation METAR de l'aéroport de Sydney (aviationweather.gov, NOAA).
import type { Metar, Verification, Weather, WeatherWarnings } from "@maroubra/core";
import { XMLParser } from "fast-xml-parser";
import { applyCorrection } from "../derive/correct";
import { SITE } from "../config";
import { fetchJson, fetchText } from "../http";
import type { Collector } from "../collector";

const HOURLY = ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "weather_code", "cloud_cover",
  "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "uv_index",
  "visibility", "relative_humidity_2m", "pressure_msl", "dew_point_2m", "is_day"];
const DAILY = ["weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_probability_max",
  "uv_index_max", "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant", "sunrise", "sunset"];
const CURRENT = ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation", "weather_code", "cloud_cover",
  "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "uv_index", "is_day", "pressure_msl", "dew_point_2m", "visibility"];

export function weatherUrl(lat = SITE.lat, lon = SITE.lon): string {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: "Australia/Sydney", timeformat: "unixtime",
    forecast_days: "10", past_days: "1", wind_speed_unit: "kmh",
    hourly: HOURLY.join(","), daily: DAILY.join(","), current: CURRENT.join(","),
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

type Cols = Record<string, (number | null)[]>;
const n = (v: number | null | undefined, d = 0) => (v == null ? d : v);

export function parseWeather(j: { current: Record<string, number>; hourly: Cols & { time: number[] }; daily: Cols & { time: number[] } }, now = Date.now()): Weather {
  const h = j.hourly;
  const all = h.time.map((t, i) => ({
    t, temp: n(h.temperature_2m[i]), feels: n(h.apparent_temperature[i]), pop: h.precipitation_probability[i] ?? null,
    precip: n(h.precipitation[i]), code: n(h.weather_code[i]), cloud: n(h.cloud_cover[i]), cloudLow: n(h.cloud_cover_low[i]),
    cloudMid: n(h.cloud_cover_mid[i]), cloudHigh: n(h.cloud_cover_high[i]), wind: n(h.wind_speed_10m[i]), windDir: n(h.wind_direction_10m[i]),
    gust: n(h.wind_gusts_10m[i]), uv: n(h.uv_index[i]), visibility: h.visibility[i] ?? null, humidity: n(h.relative_humidity_2m[i]),
    pressure: h.pressure_msl?.[i] ?? null, dewPoint: h.dew_point_2m?.[i] ?? null, isDay: h.is_day ? h.is_day[i] === 1 : undefined,
  }));
  const nowS = now / 1000;
  const rainPast24h = all.filter((x) => x.t > nowS - 86400 && x.t <= nowS).reduce((s, x) => s + x.precip, 0);
  const d = j.daily;
  const c = j.current;
  return {
    current: {
      t: c.time, temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, precip: c.precipitation,
      code: c.weather_code, cloud: c.cloud_cover, wind: c.wind_speed_10m, windDir: c.wind_direction_10m, gust: c.wind_gusts_10m,
      uv: c.uv_index, isDay: c.is_day === 1, pressure: c.pressure_msl ?? null, dewPoint: c.dew_point_2m ?? null, visibility: c.visibility ?? null,
    },
    hourly: all.filter((x) => x.t >= nowS - 3600),
    daily: d.time.map((t, i) => ({
      t, code: n(d.weather_code[i]), max: n(d.temperature_2m_max[i]), min: n(d.temperature_2m_min[i]), precip: n(d.precipitation_sum[i]),
      pop: d.precipitation_probability_max[i] ?? null, uvMax: n(d.uv_index_max[i]), windMax: n(d.wind_speed_10m_max[i]),
      gustMax: n(d.wind_gusts_10m_max[i]), windDir: n(d.wind_direction_10m_dominant[i]),
      sunrise: d.sunrise?.[i] ?? null, sunset: d.sunset?.[i] ?? null,
    })).filter((x) => x.t >= nowS - 86400),
    rainPast24h: Math.round(rainPast24h * 10) / 10,
  };
}

export const weather: Collector<Weather> = {
  id: "weather",
  everyMs: 15 * 60e3,
  staleAfterMs: 2 * 3600e3,
  // Correction locale appliquée seulement quand le Track record en ligne l'a validée.
  run: async ({ store, now }) => applyCorrection(parseWeather(await fetchJson(weatherUrl()), now.getTime()), store.data<Verification>("verify"), now.getTime()),
};

interface RawMetar { icaoId: string; obsTime: number; temp?: number; dewp?: number; wdir?: number | string; wspd?: number; wgst?: number; visib?: number | string; altim?: number; rawOb: string }

/**
 * Pluie dans un METAR : groupe de temps présent (-RA, SHRA, TSRA, DZ...) ou temps récent (RERA, RESHRA...),
 * avant les remarques. « VCSH » (averses au voisinage) ne compte pas : il ne pleut pas sur la station.
 */
export function metarRain(raw: string): boolean {
  const body = raw.split(/\sRMK\s/)[0];
  return body.split(/\s+/).some((tok) => /^(?:[-+]|RE)?(?:TS|SH)?(?:RA|DZ|GR|GS)+$/.test(tok));
}

export function parseMetar(list: RawMetar[]): Metar {
  const sorted = [...list].sort((a, b) => b.obsTime - a.obsTime);
  const m = sorted[0];
  if (!m) throw new Error("no METAR");
  return {
    station: m.icaoId, t: m.obsTime, temp: m.temp ?? null, dewpoint: m.dewp ?? null,
    windDir: typeof m.wdir === "number" ? m.wdir : null, windKt: m.wspd ?? null, gustKt: m.wgst ?? null,
    visibility: m.visib == null ? null : String(m.visib), qnh: m.altim ?? null, raw: m.rawOb, rain: metarRain(m.rawOb),
    recent: sorted.map((o) => ({ t: o.obsTime, temp: o.temp ?? null, windKt: o.wspd ?? null, windDir: typeof o.wdir === "number" ? o.wdir : null, rain: metarRain(o.rawOb), raw: o.rawOb })),
  };
}

export const metar: Collector<Metar> = {
  id: "metar",
  everyMs: 10 * 60e3,
  staleAfterMs: 90 * 60e3,
  run: async () => parseMetar(await fetchJson("https://aviationweather.gov/api/data/metar?ids=YSSY&format=json&hours=3")),
};

/** Prévision au point exact d'un juge (aéroport, bouée) : archivée pour une vérification sans décalage de lieu. */
export interface PointForecast {
  lat: number;
  lon: number;
  hourly: { t: number; temp?: number | null; wind?: number | null; gust?: number | null; pop?: number | null; precip?: number | null; hs?: number | null }[];
}

export const YSSY_POINT = { lat: -33.9461, lon: 151.1772 };

export function parsePointWeather(j: { hourly: Record<string, (number | null)[]> & { time: number[] } }, now = Date.now()): PointForecast {
  const h = j.hourly;
  return {
    ...YSSY_POINT,
    hourly: h.time.map((t, i) => ({ t, temp: h.temperature_2m[i], wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i], pop: h.precipitation_probability[i], precip: h.precipitation[i] }))
      .filter((x) => x.t >= now / 1000 - 3600),
  };
}

/** La même prévision Open-Meteo que l'écran, mais au point de l'aéroport, où le METAR la juge. */
export const airportForecast: Collector<PointForecast> = {
  id: "fc-airport",
  everyMs: 30 * 60e3,
  staleAfterMs: 3 * 3600e3,
  run: async () => {
    const q = new URLSearchParams({
      latitude: String(YSSY_POINT.lat), longitude: String(YSSY_POINT.lon), timezone: "UTC", timeformat: "unixtime", forecast_days: "3",
      wind_speed_unit: "kmh", hourly: "temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,precipitation",
    });
    return parsePointWeather(await fetchJson(`https://api.open-meteo.com/v1/forecast?${q}`));
  },
};

// Avertissements du Bureau of Meteorology : flux RSS public de NSW (usage personnel non commercial, crédit BOM).
// Le flux couvre tout l'État : on garde les types utiles à Maroubra, à l'échelle de l'État ou nommant Sydney.
const WARN_TYPES = /heatwave|severe weather|severe thunderstorm|fire weather|hazardous surf|tsunami|damaging|strong wind|gale|storm force|coastal hazard|flood/i;
const SYDNEY = /sydney|metropolitan|greater sydney|georges|cooks|parramatta|hawkesbury|nepean|woronora|botany|illawarra/i;
const STATEWIDE = /\((nsw|nsw\/act)\)|new south wales/i;
const NOT_A_WARNING = /summary|cancellation|final/i;

export function parseWarnings(xml: string): WeatherWarnings {
  const doc = new XMLParser().parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const raw = doc.rss?.channel?.item;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as { title?: string; link?: string; pubDate?: string }[];
  return {
    items: items
      .map((it) => ({ title: String(it.title ?? "").replace(/^\d{1,2}\/\d{2}:\d{2}\s+\w+\s+/, "").trim(), link: String(it.link ?? "").replace(/^http:/, "https:"), at: it.pubDate ? new Date(it.pubDate).toISOString() : "" }))
      .filter((w) => w.title && WARN_TYPES.test(w.title) && !NOT_A_WARNING.test(w.title))
      .map((w) => ({ ...w, statewide: STATEWIDE.test(w.title) && !SYDNEY.test(w.title) }))
      // Une crue est toujours locale, même quand le titre finit par « (NSW) » : seulement les rivières de Sydney.
      .filter((w) => (/flood/i.test(w.title) ? SYDNEY.test(w.title) : w.statewide || SYDNEY.test(w.title))),
  };
}

export const warnings: Collector<WeatherWarnings> = {
  id: "warnings",
  everyMs: 10 * 60e3,
  staleAfterMs: 60 * 60e3,
  run: async () => parseWarnings(await fetchText("https://www.bom.gov.au/fwo/IDZ00054.warnings_nsw.xml")),
};
