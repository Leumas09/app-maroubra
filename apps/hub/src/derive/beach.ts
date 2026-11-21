// Score de baignade de Maroubra (0 à 10), heure par heure, avec ses raisons.
// Plage orientée à l'est (normale vers 100°) : vent d'ouest = de terre (« offshore »), vent d'est = de mer.
// Règles reprises de la pratique des sauveteurs et de Beachwatch : houle, vent de mer, eau froide,
// pluie récente (eaux pluviales : éviter la baignade jusqu'à un jour après la pluie), basse mer
// (courants de baïnes plus actifs), physalies apportées par les vents d'est en saison chaude.
// Chaque heure garde les points retirés par facteur : c'est ce qui explique le meilleur créneau.
import type { Beach, BeachFactorKey, BeachReason, BeachStatus, Buoy, Marine, SwimHour, Weather } from "@maroubra/core";
import { angleDiff, compass } from "../geo";
import { minutesFromLow, type TideExtremum } from "./tide";

export const BEACH_NORMAL = 100;
/**
 * Houle près du bord rapportée à celle du large, selon la direction de la houle. Mesuré, et non supposé :
 * 17 722 paires de mesures de la bouée côtière de Collaroy-Narrabeen (14 m de fond, plage orientée est,
 * comme Maroubra) et de la bouée du large de Sydney, avril 2024 à novembre 2026 (scripts/nearshore-ratio.mts).
 * Médianes : 0,83 de NNE à ENE, 0,78 d'est, 0,62 de sud-est, 0,46 de sud. L'ancienne constante 0,8
 * surestimait les vagues par houle de sud-est et de sud, la plus fréquente à Sydney.
 */
const NEARSHORE: [number, number][] = [[45, 0.83], [90, 0.78], [135, 0.62], [180, 0.46], [225, 0.43]];
export function nearshoreFactor(dir: number | null | undefined): number {
  if (dir == null || !Number.isFinite(dir)) return 0.62; // médiane de toutes directions confondues : 0,60
  const d = ((dir % 360) + 360) % 360;
  if (d <= NEARSHORE[0][0] || d > 300) return NEARSHORE[0][1];
  for (let i = 0; i + 1 < NEARSHORE.length; i++) {
    const [a, fa] = NEARSHORE[i], [b, fb] = NEARSHORE[i + 1];
    if (d <= b) return fa + ((fb - fa) * (d - a)) / (b - a);
  }
  return NEARSHORE.at(-1)![1];
}

export type WindSide = SwimHour["side"];
export function windSide(fromDeg: number): WindSide {
  const d = angleDiff(fromDeg, BEACH_NORMAL);
  return d <= 60 ? "onshore" : d >= 120 ? "offshore" : "cross-shore";
}

const sydneyHour = (tS: number) => Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(tS * 1000));
const sydneyMonth = (tS: number) => Number(new Intl.DateTimeFormat("en-AU", { month: "numeric", timeZone: "Australia/Sydney" }).format(tS * 1000));
const sydneyDay = (tS: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(tS * 1000);
const hm = (tS: number) => new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(tS * 1000);

export interface HourInput { t: number; surf: number | null; period: number | null; swellDir?: number | null; wind: number; gust?: number; windDir: number; sst: number | null; feels: number; precip: number; pop: number | null; uv: number }

export interface ScoreCtx {
  afterRain: boolean;
  bluebottles: boolean;
  tide: TideExtremum[];
  /** Prévision officielle de pollution Beachwatch ; quand elle existe, elle remplace la règle « pluie récente ». */
  pollution?: "Unlikely" | "Possible" | "Likely" | null;
  /** Fermeture annoncée par les sauveteurs ce jour-là (raison), et jour concerné (AAAA-MM-JJ, Sydney). */
  closed?: { reason: string | null; day: string } | null;
}

export function scoreHour(h: HourInput, ctx: ScoreCtx): { score: number; reasons: BeachReason[] } {
  const r: BeachReason[] = [];
  const add = (key: BeachFactorKey, text: string, effect: BeachReason["effect"], pts = 0) => r.push({ key, text, effect, pts });
  // Sans mesure ni prévision de vagues, on ne promet pas une baignade parfaite.
  if (h.surf == null) add("surf", "Wave data unavailable: score capped at 7", "minus", 3);
  if (h.surf != null) {
    const pen = h.surf < 0.6 ? 0 : h.surf < 1 ? 1 : h.surf < 1.5 ? 2.5 : h.surf < 2 ? 4 : 6;
    add("surf", `Surf about ${h.surf.toFixed(1)} m${h.surf < 0.6 ? ", gentle" : h.surf >= 2 ? ", big and powerful" : ""}`, pen ? "minus" : "plus", pen);
    if (h.period != null && h.period >= 12 && h.surf >= 1) add("period", `Long-period swell (${Math.round(h.period)} s) breaks hard`, "minus", 1);
  }
  const side = windSide(h.windDir);
  const dir = compass(h.windDir);
  if (side === "onshore" && h.wind >= 15) add("wind", `Onshore ${dir} wind ${Math.round(h.wind)} km/h, choppy water`, "minus", h.wind >= 25 ? 2 : 1);
  else if (side === "offshore") add("wind", h.wind >= 30 ? `Strong offshore ${dir} wind ${Math.round(h.wind)} km/h, sand blowing` : `Offshore ${dir} breeze ${Math.round(h.wind)} km/h, clean water`, h.wind >= 30 ? "info" : "plus");
  else if (h.wind < 10) add("wind", `Light ${dir} wind ${Math.round(h.wind)} km/h`, "plus");
  if (h.sst != null) {
    const pen = h.sst < 16 ? 2 : h.sst < 18 ? 1 : 0;
    add("water", `Water ${h.sst.toFixed(0)}°C${h.sst < 18 ? ", cold" : h.sst >= 22 ? ", warm" : ""}`, pen ? "minus" : h.sst >= 22 ? "plus" : "info", pen);
  }
  if (h.feels < 15) add("air", `Feels like ${Math.round(h.feels)}°C on the sand`, "minus", 3);
  else if (h.feels < 18) add("air", `Cool air, feels like ${Math.round(h.feels)}°C`, "minus", 1.5);
  else if (h.feels >= 26) add("air", `Warm, feels like ${Math.round(h.feels)}°C`, "plus");
  if (h.precip >= 0.5) add("rain", "Rain expected", "minus", 2);
  else if ((h.pop ?? 0) >= 60) add("rain", `Rain likely (${h.pop}%)`, "minus", 1);
  if (ctx.pollution === "Likely") add("stormwater", "Beachwatch forecast: pollution likely, avoid swimming", "minus", 4);
  else if (ctx.pollution === "Possible") add("stormwater", "Beachwatch forecast: pollution possible", "minus", 1.5);
  else if (ctx.pollution == null && ctx.afterRain) add("stormwater", "Heavy rain in the last day: stormwater may pollute the water (Beachwatch advice)", "minus", 3);
  const fromLow = minutesFromLow(ctx.tide, h.t);
  if (fromLow != null && fromLow <= 90) add("tide", "Near low tide, rips are stronger", "minus", 0.5);
  if (ctx.bluebottles) add("bluebottles", "Easterly winds: bluebottles likely", "minus", 1);
  if (h.uv >= 8) add("uv", `UV ${Math.round(h.uv)}, very high`, "info");
  if (ctx.closed && ctx.closed.day === sydneyDay(h.t)) {
    const lost = r.reduce((a, x) => a + x.pts, 0);
    add("official", `Closed by the lifeguards${ctx.closed.reason ? `: ${ctx.closed.reason.toLowerCase()}` : ""}`, "minus", Math.max(0, 10 - lost));
  }
  const s = 10 - r.reduce((a, x) => a + x.pts, 0);
  return { score: Math.max(0, Math.min(10, Math.round(s * 10) / 10)), reasons: r };
}

export function label(score: number): Beach["label"] {
  return score >= 8 ? "Great" : score >= 6.5 ? "Good" : score >= 5 ? "Fair" : score >= 3 ? "Poor" : "Stay out";
}

/** Ce qui rend le créneau meilleur que le reste de la journée, facteur par facteur, avec l'heure du contraste. */
export function explainBest(day: SwimHour[], start: number, end: number, reasonsAtBest: BeachReason[]): { because: string[]; still: string[] } {
  const inBest = day.filter((h) => h.t >= start && h.t < end);
  const rest = day.filter((h) => h.t < start || h.t >= end);
  const avg = (hs: SwimHour[], k: BeachFactorKey) => (hs.length ? hs.reduce((a, h) => a + (h.pen[k] ?? 0), 0) / hs.length : 0);
  const worst = (k: BeachFactorKey) => rest.reduce<SwimHour | null>((w, h) => ((h.pen[k] ?? 0) > (w?.pen[k] ?? 0) ? h : w), null);
  const b = inBest[0];
  const because: string[] = [];
  const gained = new Set<BeachFactorKey>();
  if (b && rest.length) {
    const keys: BeachFactorKey[] = ["wind", "surf", "period", "rain", "air", "tide", "water"];
    const gains = keys.map((k) => ({ k, gain: avg(rest, k) - avg(inBest, k) })).filter((g) => g.gain >= 0.4).sort((x, y) => y.gain - x.gain);
    for (const { k } of gains) gained.add(k);
    for (const { k } of gains) {
      const w = worst(k);
      if (!w) continue;
      const at = hm(w.t);
      if (k === "wind") because.push(`${cap(b.side)} ${compass(b.windDir)} wind ${Math.round(b.wind)} km/h; ${w.side} ${compass(w.windDir)} ${Math.round(w.wind)} km/h at ${at}`);
      else if (k === "surf" || k === "period") because.push(`Smaller surf, about ${b.surf?.toFixed(1)} m; ${w.surf?.toFixed(1)} m${w.period ? `, ${Math.round(w.period)} s,` : ""} at ${at}`);
      else if (k === "rain") because.push(`Dry; rain ${w.pop != null ? `${w.pop}% ` : ""}likely around ${at}`);
      else if (k === "air") because.push(`Warmer on the sand, feels like ${Math.round(b.feels)}°C; ${Math.round(w.feels)}°C at ${at}`);
      else if (k === "tide") because.push(`Away from low tide, when rips pull harder (around ${at})`);
      else if (k === "water") because.push(`Warmer water, ${b.sst?.toFixed(0)}°C`);
    }
  }
  if (!because.length) because.push(rest.length ? "Conditions barely change today: this is the earliest of the best hours" : "The only daylight hours left today");
  // Ce qui reste à surveiller pendant le créneau, sans répéter un facteur déjà cité comme meilleur.
  const still = reasonsAtBest.filter((r) => r.effect === "minus" && r.pts >= 1 && !(gained.has(r.key) || (r.key === "period" && gained.has("surf")))).map((r) => r.text);
  return { because: [...new Set(because)].slice(0, 3), still: still.slice(0, 3) };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function beach(weather: Weather, marine: Marine | null, buoy: Buoy | null, tide: TideExtremum[], now = Date.now(), official: BeachStatus | null = null): Beach {
  const nowS = now / 1000;
  const mByT = new Map((marine?.hourly ?? []).map((m) => [m.t, m]));
  // Physalies : vent d'est soutenu sur les dernières 24 h, de novembre à avril.
  const past = weather.hourly.filter((h) => h.t <= nowS && h.t > nowS - 86400);
  const easterly = past.filter((h) => angleDiff(h.windDir, 70) <= 45 && h.wind >= 15).length;
  const month = sydneyMonth(nowS);
  const bluebottles = easterly >= 6 && (month >= 11 || month <= 4);
  const afterRain = weather.rainPast24h >= 10;
  const buoyNow = buoy?.latest && nowS - buoy.latest.t < 6 * 3600 ? buoy.latest : null;

  const inputs: HourInput[] = weather.hourly
    .filter((h) => h.t >= nowS - 3600 && h.t <= nowS + 36 * 3600)
    .map((h) => {
      const m = mByT.get(h.t);
      // La bouée fait foi pour les premières heures, la prévision ensuite.
      const early = h.t - nowS < 3 * 3600;
      const fromBuoy = early && buoyNow?.hs != null;
      const offshoreHs = fromBuoy ? buoyNow!.hs : m?.swellHeight ?? m?.waveHeight ?? null;
      const dir = fromBuoy ? buoyNow!.dir : m?.swellDir ?? m?.waveDir ?? null;
      return {
        t: h.t, surf: offshoreHs == null ? null : Math.round(offshoreHs * nearshoreFactor(dir) * 100) / 100, period: (early ? buoyNow?.tp : null) ?? m?.swellPeriod ?? null,
        swellDir: (early ? buoyNow?.dir : null) ?? m?.swellDir ?? null,
        wind: h.wind, gust: h.gust, windDir: h.windDir, sst: m?.sst ?? marine?.hourly[0]?.sst ?? null, feels: h.feels, precip: h.precip, pop: h.pop, uv: h.uv,
      };
    });
  const ctx: ScoreCtx = {
    afterRain, bluebottles, tide, pollution: official?.water?.forecast ?? null,
    closed: official?.status === "closed" && official.lifeguard ? { reason: official.reason, day: sydneyDay(Date.parse(official.lifeguard.at) / 1000) } : null,
  };
  const toHour = (h: HourInput): SwimHour => {
    const s = scoreHour(h, ctx);
    const pen: SwimHour["pen"] = {};
    for (const r of s.reasons) if (r.pts) pen[r.key] = (pen[r.key] ?? 0) + r.pts;
    return {
      t: h.t, score: s.score, surf: h.surf, period: h.period, swellDir: h.swellDir ?? null, wind: Math.round(h.wind), gust: Math.round(h.gust ?? h.wind),
      windDir: Math.round(h.windDir), side: windSide(h.windDir), sst: h.sst, feels: Math.round(h.feels), uv: Math.round(h.uv * 10) / 10, pop: h.pop, pen,
    };
  };
  const daylight = inputs.filter((h) => { const hr = sydneyHour(h.t); return hr >= 7 && hr <= 18; });
  const hours = daylight.map(toHour);

  // Conditions du moment : l'heure en cours, avec le vent observé par le modèle à l'instant (cohérent avec « The water »).
  const w = weather.current;
  const nowInput = inputs.find((h) => h.t >= nowS - 1800) ?? inputs[0];
  const current = nowInput ? scoreHour({ ...nowInput, wind: w.wind, windDir: w.windDir, gust: w.gust, feels: w.feels, uv: w.uv }, ctx) : { score: 0, reasons: [] };

  // Meilleur créneau de 2 heures, aujourd'hui (ou demain après 17 h)
  const targetDay = sydneyHour(nowS) >= 17 ? sydneyDay(nowS + 86400) : sydneyDay(nowS);
  const day = hours.filter((h) => sydneyDay(h.t) === targetDay && h.t >= nowS - 3600);
  let win: { start: number; end: number; score: number } | null = null;
  for (let i = 0; i + 1 < day.length; i++) {
    const s = (day[i].score + day[i + 1].score) / 2;
    if (!win || s > win.score) win = { start: day[i].t, end: day[i + 1].t + 3600, score: Math.round(s * 10) / 10 };
  }
  let best: Beach["best"] = null;
  if (win) {
    const bestInput = daylight.find((h) => h.t === win!.start);
    best = { ...win, ...explainBest(day, win.start, win.end, bestInput ? scoreHour(bestInput, ctx).reasons : []) };
  }
  const side = windSide(w.windDir);
  const hs = buoyNow?.hs ?? marine?.hourly[0]?.swellHeight ?? null;
  const seaLabel = hs == null ? "Unknown" : hs < 0.5 ? "Flat" : side === "onshore" && w.wind >= 20 ? "Choppy and messy" : hs > 2.5 ? "Big and powerful" : side === "offshore" ? "Clean" : "Moderate";
  return {
    score: current.score, label: label(current.score), reasons: current.reasons, best, hours,
    sea: {
      label: seaLabel, surfM: hs == null ? null : Math.round(hs * nearshoreFactor(buoyNow?.dir ?? marine?.hourly[0]?.swellDir) * 10) / 10, periodS: buoyNow?.tp ?? marine?.hourly[0]?.swellPeriod ?? null,
      dir: buoyNow?.dir ?? marine?.hourly[0]?.swellDir ?? null, wind: `${side}, ${Math.round(w.wind)} km/h`,
      windKmh: Math.round(w.wind), gustKmh: Math.round(w.gust), windDir: Math.round(w.windDir), side,
    },
    bluebottles, afterRain, waterTemp: marine?.hourly[0]?.sst ?? null, facing: BEACH_NORMAL,
  };
}
