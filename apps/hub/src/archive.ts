// Archive des prévisions émises et des observations, dès le premier jour : c'est la matière du
// Track record en production (on ne peut pas vérifier après coup ce qu'on n'a pas gardé).
// Les lignes ne contiennent que des données publiques ; les prévisions archivées sont toujours BRUTES.
import type { Buoy, Marine, Metar, OverheadOutcome, Sunrise, Weather } from "@maroubra/core";
import type { TableClient } from "@azure/data-tables";
import type { ArchiveData, FcRow, ObsRow, SunriseRow, VoteRow } from "./derive/verify";
import { issuedToUnix, ktToKmh, WINDOW_DAYS } from "./derive/verify";
import { metarRain, type PointForecast } from "./sources/weather";
import type { Store } from "./store";

const hourKey = (d: Date) => d.toISOString().slice(0, 13).replace(/[-T]/g, "");
const dayKey = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const monthKey = (d: Date) => d.toISOString().slice(0, 7).replace(/-/g, "");

export type Row = { partitionKey: string; rowKey: string; [k: string]: unknown };

/** Ce qu'une table doit savoir faire pour l'archive : écrire, et lire une partition. */
export interface ArchiveTable {
  upsert(row: Row): Promise<void>;
  /** Lit une partition ; `select` limite les colonnes rapatriées. */
  partition(pk: string, select?: string[]): Promise<Row[]>;
}

export function tableArchive(t: TableClient): ArchiveTable {
  return {
    upsert: async (row) => { await t.upsertEntity(row, "Replace"); },
    partition: async (pk, select) => {
      const out: Row[] = [];
      const filter = `PartitionKey eq '${pk.replace(/'/g, "''")}'`;
      for await (const e of t.listEntities({ queryOptions: { filter, ...(select ? { select: ["PartitionKey", "RowKey", ...select] } : {}) } })) {
        out.push({ ...(e as Row), partitionKey: e.partitionKey!, rowKey: e.rowKey! });
      }
      return out;
    },
  };
}

/** Archive en mémoire : développement local et tests. */
export function memoryArchive(): ArchiveTable & { rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  return {
    rows,
    upsert: async (row) => { rows.set(`${row.partitionKey}|${row.rowKey}`, { ...row }); },
    partition: async (pk) => [...rows.values()].filter((r) => r.partitionKey === pk),
  };
}

const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? -99 : v);

export function hourRows(store: Store, now = new Date()): Row[] {
  const run = hourKey(now);
  const day = run.slice(0, 8);
  const rows: Row[] = [];
  const w = store.data<Weather>("weather");
  for (const h of w?.hourly.slice(0, 50) ?? []) {
    rows.push({ partitionKey: `fc-openmeteo-${day}`, rowKey: `${run}-${h.t}`, issued: run, valid: h.t, temp: h.tempRaw ?? h.temp, wind: h.windRaw ?? h.wind, windDir: h.windDir, gust: h.gust, precip: h.precip, pop: h.pop ?? -1, cloud: h.cloud });
  }
  const a = store.data<PointForecast>("fc-airport");
  for (const h of a?.hourly.slice(0, 50) ?? []) {
    rows.push({ partitionKey: `fc-yssy-${day}`, rowKey: `${run}-${h.t}`, issued: run, valid: h.t, temp: num(h.temp), wind: num(h.wind), gust: num(h.gust), precip: num(h.precip), pop: h.pop ?? -1 });
  }
  const m = store.data<Marine>("marine");
  for (const h of m?.hourly.slice(0, 50) ?? []) {
    rows.push({ partitionKey: `fc-marine-${day}`, rowKey: `${run}-${h.t}`, issued: run, valid: h.t, hs: h.waveHeight ?? -1, swell: h.swellHeight ?? -1, tp: h.swellPeriod ?? -1, sst: h.sst ?? -1 });
  }
  const bp = store.data<PointForecast>("fc-buoy");
  for (const h of bp?.hourly.slice(0, 50) ?? []) {
    rows.push({ partitionKey: `fc-buoypt-${day}`, rowKey: `${run}-${h.t}`, issued: run, valid: h.t, hs: num(h.hs) });
  }
  const o = store.data<Metar>("metar");
  for (const x of o?.recent ?? (o ? [{ t: o.t, temp: o.temp, windKt: o.windKt, windDir: o.windDir, rain: !!o.rain, raw: o.raw }] : [])) {
    rows.push({ partitionKey: `obs-yssy-${monthKey(new Date(x.t * 1000))}`, rowKey: String(x.t), temp: x.temp ?? -99, windKt: x.windKt ?? -1, windDir: x.windDir ?? -1, rain: x.rain ? 1 : 0, raw: x.raw });
  }
  const buoy = store.data<Buoy>("buoy");
  for (const b of buoy?.series.slice(-6) ?? []) {
    rows.push({ partitionKey: `obs-buoy-${monthKey(new Date(b.t * 1000))}`, rowKey: String(b.t), hs: b.hs ?? -1, tp: b.tp ?? -1, dir: b.dir ?? -1 });
  }
  // Score du lever de soleil : la dernière prévision émise avant le lever reste dans l'archive.
  const s = store.data<Sunrise>("sunrise");
  if (s && Date.parse(s.time) > now.getTime()) rows.push({ partitionKey: `sunrise-${s.date.slice(0, 4)}`, rowKey: s.date, score: s.score, label: s.label, issued: run });
  return rows;
}

export async function archiveHour(table: ArchiveTable | null, store: Store, now = new Date()) {
  if (!table) return 0;
  let n = 0;
  for (const r of hourRows(store, now)) {
    try { await table.upsert(r); n++; } catch (err) { console.error(JSON.stringify({ event: "archive_failed", error: String(err) })); break; }
  }
  return n;
}

export async function archiveOutcome(table: ArchiveTable | null, o: OverheadOutcome) {
  await table?.upsert({ partitionKey: `ovh-${o.at.slice(0, 7).replace("-", "")}`, rowKey: `${o.at}-${o.hex}`, ...o, callsign: o.callsign ?? "", minKm: o.minKm ?? -1 })
    .catch((err) => console.error(JSON.stringify({ event: "archive_failed", error: String(err) })));
}

export async function archiveSunriseSky(table: ArchiveTable | null, s: { date: string; at: string; score: number; points: unknown }) {
  await table?.upsert({ partitionKey: `sunsat-${s.date.slice(0, 4)}`, rowKey: s.date, at: s.at, score: s.score, points: JSON.stringify(s.points) })
    .catch((err) => console.error(JSON.stringify({ event: "archive_failed", error: String(err) })));
}

export async function archiveVote(table: ArchiveTable | null, v: { date: string; value: number; voter: string }) {
  await table?.upsert({ partitionKey: `vote-${v.date.slice(0, 4)}`, rowKey: `${v.date}-${v.voter}`, date: v.date, value: v.value, at: new Date().toISOString() });
}

// Lecture : les partitions de plus de deux jours ne changent plus, on les garde en cache.
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > -90 ? v : null);

const toFc = (r: Row): FcRow => ({
  issued: issuedToUnix(String(r.issued)), valid: Number(r.valid), temp: n(r.temp), wind: n(r.wind),
  pop: typeof r.pop === "number" && r.pop >= 0 ? r.pop : null, hs: n(r.hs),
});

const FC_COLS = ["issued", "valid", "temp", "wind", "pop", "hs"];

/** Exécute des tâches avec au plus `limit` en parallèle. */
async function pool<T>(tasks: (() => Promise<T>)[], limit = 8): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); }
  }));
  return out;
}

const toMetar = (r: Row): ObsRow => ({
  t: Number(r.rowKey), temp: n(r.temp), windKmh: typeof r.windKt === "number" && r.windKt >= 0 ? ktToKmh(r.windKt) : null,
  // Les lignes d'avant le 21/11/2026 n'ont pas de drapeau de pluie : on le relit dans le message brut.
  rain: typeof r.rain === "number" ? r.rain === 1 : typeof r.raw === "string" ? metarRain(r.raw) : null,
});

/**
 * Lecteur de l'archive pour la vérification. Les partitions de plus de deux jours ne changent plus :
 * elles restent en cache, sous forme compacte (quelques dizaines d'octets par ligne).
 */
export function archiveReader(table: ArchiveTable) {
  const cache = new Map<string, unknown[]>();
  const frozen = (pk: string, now: Date) => {
    const tail = pk.split("-").at(-1)!;
    const old = new Date(now.getTime() - 2 * 86400e3);
    if (tail.length === 8) return tail < dayKey(old);
    if (tail.length === 6) return tail < monthKey(old);
    return false;
  };
  async function part<T>(pk: string, now: Date, map: (r: Row) => T, select?: string[]): Promise<T[]> {
    if (cache.has(pk)) return cache.get(pk) as T[];
    const rows = (await table.partition(pk, select)).map(map);
    if (frozen(pk, now)) cache.set(pk, rows);
    return rows;
  }
  return async function load(now = new Date()): Promise<ArchiveData> {
    const days = Array.from({ length: WINDOW_DAYS + 3 }, (_, i) => dayKey(new Date(now.getTime() - i * 86400e3)));
    const months = [...new Set(days.map((d) => d.slice(0, 6)))];
    const years = [...new Set(days.map((d) => d.slice(0, 4)))];
    const fcs = (prefix: string) => days.map((d) => () => part(`${prefix}-${d}`, now, toFc, FC_COLS));
    const groups = await pool<unknown[]>([
      ...fcs("fc-openmeteo"), ...fcs("fc-yssy"), ...fcs("fc-marine"), ...fcs("fc-buoypt"),
      ...months.map((m) => () => part(`obs-yssy-${m}`, now, toMetar, ["temp", "windKt", "rain", "raw"])),
      ...months.map((m) => () => part(`obs-buoy-${m}`, now, (r): ObsRow => ({ t: Number(r.rowKey), hs: n(r.hs) }), ["hs"])),
      ...months.map((m) => () => part(`ovh-${m}`, now, (r): OverheadOutcome => ({ hex: String(r.hex), callsign: (r.callsign as string) || null, at: String(r.at), inMin: Number(r.inMin), minKm: n(r.minKm), hit: r.hit === true }))),
      ...years.map((y) => () => part(`sunrise-${y}`, now, (r): SunriseRow => ({ date: r.rowKey, score: Number(r.score) }), ["score"])),
      ...years.map((y) => () => part(`sunsat-${y}`, now, (r): SunriseRow => ({ date: r.rowKey, score: Number(r.score) }), ["score"])),
      ...years.map((y) => () => part(`vote-${y}`, now, (r): VoteRow => ({ date: String(r.date), value: Number(r.value) }), ["date", "value"])),
    ]);
    const live = new Set([...days.flatMap((d) => ["fc-openmeteo", "fc-yssy", "fc-marine", "fc-buoypt"].map((p) => `${p}-${d}`)), ...months.flatMap((m) => [`obs-yssy-${m}`, `obs-buoy-${m}`, `ovh-${m}`])]);
    for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
    const D = days.length, M = months.length, Y = years.length;
    let i = 0;
    const take = <T>(k: number) => groups.slice(i, (i += k)).flat() as T[];
    const fcMaroubra = take<FcRow>(D), fcAirport = take<FcRow>(D), fcMarine = take<FcRow>(D), fcBuoy = take<FcRow>(D);
    const metar = take<ObsRow>(M), buoy = take<ObsRow>(M), overhead = take<OverheadOutcome>(M);
    const sunrise = take<SunriseRow>(Y), sunriseSky = take<SunriseRow>(Y), votes = take<VoteRow>(Y);
    return { fcMaroubra, fcAirport, fcMarine, fcBuoy, metar, buoy, overhead, sunrise, sunriseSky, votes };
  };
}
