// Bandeau de l'accueil : les bus 396 du matin vers Maroubra Junction, horaires officiels de Transport for NSW.
import table from "../data/bus-396.json";
import { busDay, type BusTable } from "../lib/bus";

const t = table as unknown as BusTable;
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

export function BusLine({ now }: { now: Date }) {
  const d = busDay(t, now);
  const groups = t.windows.map(([a, b]) => d.times.filter((x) => x.t >= a && x.t <= b));
  const next = d.times.find((x) => x.next);
  return (
    <section className="bus-line" aria-label={`Bus ${t.route} towards Maroubra Junction`}>
      <div className="bus-head">
        <span className="bus-route" aria-hidden="true">{t.route}</span>
        <span>
          <strong>{d.today ? "This morning" : dayLabel(d.date)}</strong>
          <span className="muted"> · {t.stop.name}, towards Maroubra Junction</span>
        </span>
        {next && next.inMin != null && <span className="bus-next">Next in {next.inMin} min</span>}
      </div>
      {!d.covered ? <p className="muted bus-none">Timetable not loaded for this date: it needs a refresh from Transport for NSW.</p> : (
        <div className="bus-groups">
          {groups.map((g, i) => (
            <div key={i} className="bus-group">
              <span className="bus-win">{t.windows[i][0]} to {t.windows[i][1]}</span>
              {g.length ? g.map((x) => <span key={x.t} className={`bus-time${x.gone ? " gone" : ""}${x.next ? " next" : ""}`}>{x.t}</span>) : <span className="muted">No bus</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
