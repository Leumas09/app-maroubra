// Track record en production : chaque prévision archivée par le hub est confrontée à son juge
// (METAR de l'aéroport, bouée de Sydney, traces ADS-B, votes de la famille), sur 30 jours glissants.
//
// La correction locale est apprise EN LIGNE : pour juger une prévision émise à l'instant I, on n'utilise
// que les observations antérieures à I. Le score « corrigé » est donc celui qu'on aurait vraiment affiché.
// Elle n'est appliquée à l'écran que si elle bat le modèle brut sur les 14 derniers jours.
import type { CorrectionState, LeadScore, LiveScore, OverheadOutcome, ScoreStatus, Verification } from "@maroubra/core";

export const WINDOW_DAYS = 30;
const GATE_DAYS = 14;
const DECAY_DAYS = 10;
const KT_TO_KMH = 1.852;

/** Tranches d'échéance (heures), bornes basses incluses. */
export const LEAD_BUCKETS: [number, number, string][] = [[0, 6, "0–6 h"], [6, 12, "6–12 h"], [12, 24, "12–24 h"], [24, 49, "24–48 h"]];
export const leadBucket = (leadH: number) => LEAD_BUCKETS.findIndex(([a, b]) => leadH >= a && leadH < b);

const HOUR_FMT = new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" });
export const sydneyHour = (tS: number) => Number(HOUR_FMT.format(tS * 1000)) % 24;

/** Une prévision archivée : émise à `issued`, valable à `valid` (secondes Unix). */
export interface FcRow { issued: number; valid: number; temp?: number | null; wind?: number | null; pop?: number | null; hs?: number | null }
export interface ObsRow { t: number; temp?: number | null; windKmh?: number | null; rain?: boolean | null; hs?: number | null }

/** « 2026110305 » (heure UTC de l'archivage) vers secondes Unix. */
export function issuedToUnix(issued: string): number {
  const y = +issued.slice(0, 4), m = +issued.slice(4, 6), d = +issued.slice(6, 8), h = +issued.slice(8, 10);
  return Date.UTC(y, m - 1, d, h) / 1000;
}

/** Observation la plus proche de t, à `tolS` près (les METAR tombent à :00 et :30). */
export function nearest(obs: ObsRow[], t: number, tolS = 20 * 60): ObsRow | null {
  let lo = 0, hi = obs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (obs[mid].t < t) lo = mid + 1; else hi = mid; }
  let best: ObsRow | null = null;
  for (const i of [lo - 1, lo]) {
    const o = obs[i];
    if (o && Math.abs(o.t - t) <= tolS && (!best || Math.abs(o.t - t) < Math.abs(best.t - t))) best = o;
  }
  return best;
}

export interface Pair { issued: number; valid: number; lead: number; fc: number; obs: number }

/** Apparie prévisions et observations pour une variable (échéances de 0 à 48 h). */
export function pairs(fc: FcRow[], obs: ObsRow[], fcKey: keyof FcRow, obsKey: keyof ObsRow, tolS?: number): Pair[] {
  const sorted = [...obs].sort((a, b) => a.t - b.t);
  const out: Pair[] = [];
  for (const f of fc) {
    const v = f[fcKey];
    if (typeof v !== "number" || !Number.isFinite(v) || v < -90) continue;
    const lead = (f.valid - f.issued) / 3600;
    if (lead < 0 || lead >= 49) continue;
    const o = nearest(sorted, f.valid, tolS);
    const ov = o?.[obsKey];
    if (typeof ov !== "number" || !Number.isFinite(ov) || ov < -90) continue;
    out.push({ issued: f.issued, valid: f.valid, lead, fc: v, obs: ov });
  }
  return out;
}

/**
 * Biais à moyenne décroissante (méthode de la NOAA), par tranche d'échéance et heure locale de validité.
 * L'accumulateur décroît avec le temps (constante DECAY_DAYS) et se rétrécit vers zéro tant qu'il a peu de données.
 */
export class DecayingBias {
  private sum: number[][];
  private w: number[][];
  private last: number[][];
  constructor(private tauS = DECAY_DAYS * 86400, private prior = 4) {
    const grid = () => LEAD_BUCKETS.map(() => new Array(24).fill(0));
    this.sum = grid(); this.w = grid(); this.last = grid();
  }
  private decay(b: number, h: number, t: number) {
    const dt = t - this.last[b][h];
    if (dt > 0 && this.last[b][h] > 0) {
      const k = Math.exp(-dt / this.tauS);
      this.sum[b][h] *= k; this.w[b][h] *= k;
    }
    this.last[b][h] = Math.max(this.last[b][h], t);
  }
  learn(p: Pair) {
    const b = leadBucket(p.lead), h = sydneyHour(p.valid);
    if (b < 0) return;
    this.decay(b, h, p.valid);
    this.sum[b][h] += p.fc - p.obs;
    this.w[b][h] += 1;
  }
  private cell(b: number, h: number, at: number): number {
    const dt = Math.max(0, at - this.last[b][h]);
    const k = this.last[b][h] > 0 ? Math.exp(-dt / this.tauS) : 0;
    return (this.sum[b][h] * k) / (this.w[b][h] * k + this.prior);
  }
  table(at: number): number[][] {
    return LEAD_BUCKETS.map((_, b) => Array.from({ length: 24 }, (_, h) => Math.round(this.cell(b, h, at) * 100) / 100));
  }
  /** Biais lissé, exactement celui qu'on applique à l'écran (voir smoothBias). */
  bias(leadH: number, validS: number, at: number): number {
    return smoothBias((b, h) => this.cell(b, h, at), leadH, sydneyHour(validS));
  }
}

/** Centres des tranches d'échéance, pour interpoler entre elles. */
const CENTERS = LEAD_BUCKETS.map(([a, b]) => (a + Math.min(b, 48)) / 2);

/**
 * Biais lissé : moyenne pondérée 1-2-1 sur les heures voisines (le biais d'un modèle varie lentement
 * dans la journée), puis interpolation linéaire entre les centres des tranches d'échéance.
 * Sans ce lissage, la courbe corrigée ferait des marches aux bornes des tranches.
 */
export function smoothBias(cell: (b: number, h: number) => number, leadH: number, hour: number): number {
  const at = (b: number) => (cell(b, (hour + 23) % 24) + 2 * cell(b, hour) + cell(b, (hour + 1) % 24)) / 4;
  if (leadH <= CENTERS[0]) return at(0);
  for (let b = 0; b + 1 < CENTERS.length; b++) {
    if (leadH <= CENTERS[b + 1]) {
      const f = (leadH - CENTERS[b]) / (CENTERS[b + 1] - CENTERS[b]);
      return at(b) * (1 - f) + at(b + 1) * f;
    }
  }
  return leadH < 49 ? at(CENTERS.length - 1) : 0;
}

export interface Corrected extends Pair { corrected: number }

/**
 * Rejoue l'histoire dans l'ordre : avant de juger une prévision émise à I, on apprend de toutes les
 * observations valables avant I, et seulement d'elles. Aucune fuite du futur.
 */
export function replay(ps: Pair[], opts: { floor?: number } = {}): { scored: Corrected[]; model: DecayingBias } {
  const model = new DecayingBias();
  const learnOrder = [...ps].sort((a, b) => a.valid - b.valid);
  const predictOrder = [...ps].sort((a, b) => a.issued - b.issued);
  const scored: Corrected[] = [];
  let j = 0;
  for (const p of predictOrder) {
    while (j < learnOrder.length && learnOrder[j].valid < p.issued) model.learn(learnOrder[j++]);
    let c = p.fc - model.bias(p.lead, p.valid, p.issued);
    if (opts.floor != null) c = Math.max(opts.floor, c);
    scored.push({ ...p, corrected: c });
  }
  while (j < learnOrder.length) model.learn(learnOrder[j++]);
  return { scored, model };
}

const mae = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length : NaN);
const r2 = (x: number) => Math.round(x * 100) / 100;

export function byLead(scored: Corrected[]): LeadScore[] {
  return LEAD_BUCKETS.map(([, , label], b) => {
    const s = scored.filter((p) => leadBucket(p.lead) === b);
    return { lead: label, n: s.length, raw: r2(mae(s.map((p) => p.fc - p.obs))), corrected: s.length ? r2(mae(s.map((p) => p.corrected - p.obs))) : null };
  }).filter((l) => l.n > 0);
}

/** Intervalle de confiance à 95 % du gain relatif, par bootstrap sur des blocs d'un jour (les erreurs d'une journée sont liées). */
export function gainInterval(scored: Corrected[], draws = 400, seed = 7): [number, number] | null {
  const days = new Map<number, { raw: number; cor: number; n: number }>();
  for (const p of scored) {
    const d = Math.floor(p.valid / 86400);
    const e = days.get(d) ?? { raw: 0, cor: 0, n: 0 };
    e.raw += Math.abs(p.fc - p.obs); e.cor += Math.abs(p.corrected - p.obs); e.n++;
    days.set(d, e);
  }
  const list = [...days.values()];
  if (list.length < 7) return null;
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const gains: number[] = [];
  for (let k = 0; k < draws; k++) {
    let raw = 0, cor = 0;
    for (let i = 0; i < list.length; i++) { const e = list[Math.floor(rnd() * list.length)]; raw += e.raw; cor += e.cor; }
    gains.push(1 - cor / raw);
  }
  gains.sort((a, b) => a - b);
  return [gains[Math.floor(draws * 0.025)], gains[Math.floor(draws * 0.975)]];
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const status = (n: number, min: number, ok: boolean): ScoreStatus => (n < min ? "collecting" : ok ? "met" : "missed");

function continuous(key: "temp" | "wind", ps: Pair[], now: number, floor?: number): { score: LiveScore; correction: CorrectionState } {
  const { scored, model } = replay(ps, { floor });
  const recent = scored.filter((p) => p.valid >= now - WINDOW_DAYS * 86400 && p.valid <= now);
  const gate = recent.filter((p) => p.valid >= now - GATE_DAYS * 86400);
  const rawMae = mae(recent.map((p) => p.fc - p.obs));
  const corMae = mae(recent.map((p) => p.corrected - p.obs));
  const gain = 1 - corMae / rawMae;
  const ci = gainInterval(recent);
  const gRaw = mae(gate.map((p) => p.fc - p.obs)), gCor = mae(gate.map((p) => p.corrected - p.obs));
  const on = gate.length >= 300 && gCor < gRaw * 0.97;
  const unit = key === "temp" ? "°C" : "km/h";
  const title = key === "temp" ? "Temperature, live" : "Wind, live";
  const n = recent.length;
  const days = new Set(recent.map((p) => Math.floor(p.valid / 86400))).size;
  return {
    score: {
      key, title, unit, n, since: recent[0] ? new Date(Math.min(...recent.map((p) => p.valid)) * 1000).toISOString() : null,
      judge: "Sydney Airport METAR, every half hour",
      target: "error −25% vs raw model",
      status: status(days, 7, gain >= 0.25),
      result: n ? `${r2(corMae)} ${unit} mean error, ${gain >= 0 ? "−" : "+"}${pct(Math.abs(gain))} vs raw` : "No data yet",
      detail: n
        ? `Raw model ${r2(rawMae)} ${unit}${ci ? `, 95% interval of the gain ${pct(ci[0])} to ${pct(ci[1])}` : ""}. ${days} days, ${n} forecast hours, each corrected only with what was known when it was issued.`
        : "The archive needs a few days of forecasts and observations.",
      leads: byLead(recent),
    },
    correction: {
      on, n: gate.length,
      why: gate.length < 300 ? `Learning: ${gate.length} of 300 checked hours` : on ? `Beats the raw model by ${pct(1 - gCor / gRaw)} over ${GATE_DAYS} days` : `Does not beat the raw model over ${GATE_DAYS} days`,
      bias: model.table(now), rawMae: Number.isFinite(gRaw) ? r2(gRaw) : null, correctedMae: Number.isFinite(gCor) ? r2(gCor) : null,
    },
  };
}

/** Pluie : score de Brier de la probabilité affichée, comparé à la fréquence climatologique de la fenêtre. */
export function rainScore(fc: FcRow[], obs: ObsRow[], now: number): LiveScore {
  const ps = pairs(fc.map((f) => ({ ...f, pop: f.pop != null && f.pop >= 0 ? f.pop / 100 : null })), obs.map((o) => ({ ...o, rain: undefined, hs: o.rain == null ? null : o.rain ? 1 : 0 })), "pop", "hs")
    .filter((p) => p.valid >= now - WINDOW_DAYS * 86400 && p.valid <= now && p.lead < 24);
  const n = ps.length;
  const base = n ? ps.reduce((s, p) => s + p.obs, 0) / n : 0;
  const bs = n ? ps.reduce((s, p) => s + (p.fc - p.obs) ** 2, 0) / n : NaN;
  const bsRef = n ? ps.reduce((s, p) => s + (base - p.obs) ** 2, 0) / n : NaN;
  const skill = bsRef > 0 ? 1 - bs / bsRef : NaN;
  const wet = ps.filter((p) => p.obs === 1).length;
  return {
    key: "rain", title: "Chance of rain, live", n, since: ps[0] ? new Date(ps[0].valid * 1000).toISOString() : null,
    judge: "Rain reported in the Sydney Airport METAR",
    target: "better than climatology (Brier skill > 0)",
    status: status(wet, 10, skill > 0),
    result: Number.isFinite(skill) ? `Brier skill ${skill >= 0 ? "+" : ""}${r2(skill)}` : "No data yet",
    detail: n ? `${wet} rainy hours out of ${n} checked (next 24 h forecasts). 0 means no better than always saying ${Math.round(base * 100)}%, 1 is perfect.${wet < 10 ? " Needs at least 10 rainy hours to judge." : ""}` : "The archive needs a few days.",
  };
}

export function wavesScore(fc: FcRow[], obs: ObsRow[], now: number, atBuoy: boolean): LiveScore {
  const ps = pairs(fc, obs, "hs", "hs", 35 * 60).filter((p) => p.valid >= now - WINDOW_DAYS * 86400 && p.valid <= now && p.lead < 49);
  const err = mae(ps.map((p) => p.fc - p.obs));
  const bias = ps.length ? ps.reduce((s, p) => s + p.fc - p.obs, 0) / ps.length : NaN;
  const days = new Set(ps.map((p) => Math.floor(p.valid / 86400))).size;
  return {
    key: "waves", title: "Wave height, live", unit: "m", n: ps.length, since: ps[0] ? new Date(ps[0].valid * 1000).toISOString() : null,
    judge: "Sydney Waverider buoy (Manly Hydraulics Laboratory)",
    target: "within 30 cm on average",
    status: status(days, 7, err <= 0.3),
    result: ps.length ? `${Math.round(err * 100)} cm mean error, bias ${bias >= 0 ? "+" : "−"}${Math.round(Math.abs(bias) * 100)} cm` : "No data yet",
    detail: ps.length ? `${days} days, ${ps.length} forecast hours up to 48 h ahead.${atBuoy ? "" : " Forecast for Maroubra judged at the buoy 25 km north-east, so part of the error is distance."}` : "The archive needs a few days.",
    leads: byLead(ps.map((p) => ({ ...p, corrected: p.fc }))).map((l) => ({ ...l, corrected: null })),
  };
}

export function overheadScore(outcomes: OverheadOutcome[], now: number): LiveScore {
  const recent = outcomes.filter((o) => Date.parse(o.at) / 1000 >= now - WINDOW_DAYS * 86400);
  const hits = recent.filter((o) => o.hit).length;
  const rate = recent.length ? hits / recent.length : NaN;
  const near = recent.filter((o) => o.minKm != null).map((o) => o.minKm!).sort((a, b) => a - b);
  return {
    key: "overhead", title: "“Overhead in N min”, live", n: recent.length, since: recent[0]?.at ?? null,
    judge: "The aircraft's own ADS-B track afterwards",
    target: "90% pass within 1.5 km",
    status: status(recent.length, 20, rate >= 0.9),
    result: recent.length ? `${Math.round(rate * 100)}% confirmed (${hits} of ${recent.length})` : "No announcement yet",
    detail: recent.length ? `Median closest approach ${near.length ? near[Math.floor(near.length / 2)].toFixed(1) : "n/a"} km. An announcement counts only if the aircraft really passed within 1.5 km of home.` : "Announcements happen when a plane is heading straight over the house.",
  };
}

/** Corrélation de rang de Spearman (rangs moyens en cas d'égalité). */
export function spearman(x: number[], y: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((val, i) => ({ val, i })).sort((a, b) => a.val - b.val);
    const r = new Array(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].val === idx[i].val) j++;
      for (let k = i; k <= j; k++) r[idx[k].i] = (i + j) / 2;
      i = j + 1;
    }
    return r as number[];
  };
  const rx = rank(x), ry = rank(y), n = x.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

export interface SunriseRow { date: string; score: number }
export interface VoteRow { date: string; value: number } // 0 non, 1 bof, 2 oui

export function sunriseScore(forecasts: SunriseRow[], votes: VoteRow[]): LiveScore {
  const byDate = new Map<string, number[]>();
  for (const v of votes) byDate.set(v.date, [...(byDate.get(v.date) ?? []), v.value]);
  const fc = new Map(forecasts.map((f) => [f.date, f.score]));
  const rows = [...byDate].filter(([d]) => fc.has(d)).map(([d, vs]) => ({ d, score: fc.get(d)!, vote: vs.reduce((a, b) => a + b, 0) / vs.length }));
  const rho = rows.length >= 3 ? spearman(rows.map((r) => r.score), rows.map((r) => r.vote)) : NaN;
  return {
    key: "sunrise", title: "Sunrise score", n: rows.length, since: rows.map((r) => r.d).sort()[0] ?? null,
    judge: "The family's votes the morning after",
    target: "rank correlation of 0.6 or more",
    status: status(rows.length, 8, rho >= 0.6),
    result: rows.length ? (Number.isFinite(rho) ? `ρ = ${r2(rho)} over ${rows.length} mornings` : `${rows.length} morning${rows.length > 1 ? "s" : ""} rated`) : "No vote yet",
    detail: `Each morning, the home screen asks whether the sunrise was worth it. ${rows.length < 8 ? `Needs ${8 - rows.length} more rated mornings to judge.` : "1 would mean the score always ranks mornings like the family does."}`,
  };
}

export interface ArchiveData {
  /** Prévision Open-Meteo au point de l'aéroport (juge sans décalage de lieu). */
  fcAirport: FcRow[];
  /** Prévision affichée pour Maroubra (repli tant que le point aéroport n'a pas d'historique). */
  fcMaroubra: FcRow[];
  fcBuoy: FcRow[];
  fcMarine: FcRow[];
  metar: ObsRow[];
  buoy: ObsRow[];
  overhead: OverheadOutcome[];
  sunrise: SunriseRow[];
  votes: VoteRow[];
}

/** Le point aéroport prend le relais dès qu'il a une semaine d'historique. */
const preferred = (a: FcRow[], b: FcRow[]) => (new Set(a.map((r) => Math.floor(r.valid / 86400))).size >= 7 ? a : b);

export function verify(d: ArchiveData, now = Date.now() / 1000): Verification {
  const fc = preferred(d.fcAirport, d.fcMaroubra);
  const temp = continuous("temp", pairs(fc, d.metar, "temp", "temp"), now);
  const wind = continuous("wind", pairs(fc, d.metar, "wind", "windKmh"), now, 0);
  const atBuoy = new Set(d.fcBuoy.map((r) => Math.floor(r.valid / 86400))).size >= 7;
  return {
    at: new Date(now * 1000).toISOString(),
    windowDays: WINDOW_DAYS,
    scores: [
      temp.score, wind.score, rainScore(fc, d.metar, now),
      wavesScore(atBuoy ? d.fcBuoy : d.fcMarine, d.buoy, now, atBuoy),
      // Pas de score « lever de soleil vu par satellite » : l'infrarouge seul suit mal les étages de nuages
      // (corrélation 0,19 pour les bas, 0,44 pour les moyens et hauts, contre le METAR ; voir docs/PLAN.md, partie I).
      // Les observations restent archivées pour un futur classement multi-bandes.
      overheadScore(d.overhead, now), sunriseScore(d.sunrise, d.votes),
    ],
    correction: { temp: temp.correction, wind: wind.correction },
  };
}

export const ktToKmh = (kt: number) => kt * KT_TO_KMH;
