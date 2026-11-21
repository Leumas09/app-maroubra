// Bus 396 du matin : horaires officiels de Transport for NSW (GTFS, extraits par apps/hub/scripts/bus_396.py).
// Règle de Samuel : un jour de semaine jusqu'à 8 h 45, on montre ce jour ; après 8 h 45, et le week-end,
// on montre le jour de semaine suivant (lundi pour le samedi et le dimanche).

export interface BusTable { route: string; stop: { id: string; name: string }; towards: string; windows: [string, string][]; published: string | null; from: string; to: string; days: Record<string, string[]> }

const TZ = "Australia/Sydney";
const parts = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, weekday: p.weekday as string };
};
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());

export interface BusDay { date: string; today: boolean; times: { t: string; gone: boolean; next: boolean; inMin: number | null }[]; covered: boolean }

export function busDay(table: BusTable, now: Date): BusDay {
  const { date, hm } = parts(now);
  let day = date;
  if (isWeekend(day) || hm > "08:45") { day = addDays(day, 1); while (isWeekend(day)) day = addDays(day, 1); }
  const today = day === date;
  const list = table.days[day];
  const nowMin = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
  let nextSet = false;
  const times = (list ?? []).map((t) => {
    const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const gone = today && m < nowMin;
    const next = !gone && !nextSet && today;
    if (next) nextSet = true;
    return { t, gone, next, inMin: today && !gone ? m - nowMin : null };
  });
  return { date: day, today, times, covered: list != null };
}
