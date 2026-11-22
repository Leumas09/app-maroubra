// Bus 396 et 396X : horaires officiels de Transport for NSW (GTFS, extraits par apps/hub/scripts/bus.py).
// Le fichier garde tous les départs de la journée ; les plages affichées se règlent dans Settings (par appareil).
// Règle de Samuel : un jour de semaine jusqu'à la fin de la dernière plage, on montre ce jour ; ensuite,
// et le week-end, on montre le jour de semaine suivant (lundi pour le samedi et le dimanche).

export interface BusTable {
  routes: string[];
  stop: { id: string; name: string };
  towards: string;
  source: string;
  published: string | null;
  from: string;
  to: string;
  /** Horaires distincts, par ligne : heures « HH:MM » triées. */
  timetables: Record<string, string[]>[];
  /** Jour de semaine (AAAA-MM-JJ) vers l'indice de son horaire. */
  days: Record<string, number>;
}

/** Plage horaire [début, fin], bornes comprises, en « HH:MM » le même jour. */
export type BusWindow = [string, string];

/** Plages par défaut : 7 h 15 à 7 h 45, et 8 h 15 à 9 h 15 (élargie le 22 novembre 2026, à la demande de Samuel). */
export const DEFAULT_WINDOWS: BusWindow[] = [["07:15", "07:45"], ["08:15", "09:15"]];
export const MAX_WINDOWS = 4;

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isWindow = (w: unknown): w is BusWindow => Array.isArray(w) && w.length === 2 && w.every((x) => typeof x === "string" && HM.test(x)) && w[0] < w[1];

/** Plages valides, triées, celles qui se chevauchent fusionnées ; null si la liste n'est pas utilisable. */
export function normalizeWindows(ws: unknown): BusWindow[] | null {
  if (!Array.isArray(ws) || ws.length === 0 || ws.length > MAX_WINDOWS || !ws.every(isWindow)) return null;
  const out: BusWindow[] = [];
  for (const [a, b] of [...ws].sort((x, y) => x[0].localeCompare(y[0]))) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = b > last[1] ? b : last[1];
    else out.push([a, b]);
  }
  return out;
}

const KEY = "mb.bus.windows";
export function loadBusWindows(): BusWindow[] {
  try { return normalizeWindows(JSON.parse(localStorage.getItem(KEY) ?? "null")) ?? DEFAULT_WINDOWS; } catch { return DEFAULT_WINDOWS; }
}
export function saveBusWindows(ws: BusWindow[] | null) {
  try { if (ws) localStorage.setItem(KEY, JSON.stringify(ws)); else localStorage.removeItem(KEY); } catch { /* stockage indisponible */ }
}

const TZ = "Australia/Sydney";
const parts = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
};
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

export interface BusTime { t: string; route: string; gone: boolean; next: boolean; inMin: number | null }
export interface BusDay { date: string; today: boolean; covered: boolean; groups: { window: BusWindow; times: BusTime[] }[] }

export function busDay(table: BusTable, now: Date, windows: BusWindow[] = DEFAULT_WINDOWS): BusDay {
  const ws = normalizeWindows(windows) ?? DEFAULT_WINDOWS;
  const lastEnd = ws[ws.length - 1][1];
  const { date, hm } = parts(now);
  let day = date;
  if (isWeekend(day) || hm > lastEnd) { day = addDays(day, 1); while (isWeekend(day)) day = addDays(day, 1); }
  const today = day === date;
  const i = table.days[day];
  const tt = i == null ? null : table.timetables[i];
  const all = tt ? table.routes.flatMap((route) => (tt[route] ?? []).map((t) => ({ t, route }))).sort((a, b) => a.t.localeCompare(b.t) || a.route.localeCompare(b.route)) : [];
  const nowMin = minutes(hm);
  let nextSet = false;
  const groups = ws.map((window) => ({
    window,
    times: all.filter((x) => x.t >= window[0] && x.t <= window[1]).map(({ t, route }) => {
      const m = minutes(t);
      const gone = today && m < nowMin;
      const next = today && !gone && !nextSet;
      if (next) nextSet = true;
      return { t, route, gone, next, inMin: today && !gone ? m - nowMin : null };
    }),
  }));
  return { date: day, today, covered: tt != null, groups };
}
