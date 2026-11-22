// Bandeau de l'accueil : les bus 396 et 396X vers Maroubra Junction et la ville, horaires officiels de Transport for NSW.
// Les plages horaires viennent de Settings (par appareil) ; on les relit à chaque affichage de l'accueil.
import { useEffect, useState } from "react";
import table from "../data/bus.json";
import { busDay, loadBusWindows, type BusTable } from "../lib/bus";

const t = table as unknown as BusTable;
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const isExpress = (route: string) => route.endsWith("X");

export function BusLine({ now }: { now: Date }) {
  const [windows, setWindows] = useState(loadBusWindows);
  // Un autre onglet ouvert sur Settings : on suit son réglage.
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === null || e.key === "mb.bus.windows") setWindows(loadBusWindows()); };
    addEventListener("storage", on);
    return () => removeEventListener("storage", on);
  }, []);
  const d = busDay(t, now, windows);
  const next = d.groups.flatMap((g) => g.times).find((x) => x.next);
  const morning = d.groups[d.groups.length - 1].window[1] <= "12:00";
  return (
    <section className="bus-line" aria-label={`Buses ${t.routes.join(" and ")} towards Maroubra Junction`}>
      <div className="bus-head">
        <span className="bus-routes" aria-hidden="true">
          {t.routes.map((r) => <span key={r} className={`bus-route${isExpress(r) ? " x" : ""}`}>{r}</span>)}
        </span>
        <span>
          <strong>{d.today ? (morning ? "This morning" : "Today") : dayLabel(d.date)}</strong>
          <span className="muted"> · {t.stop.name}, towards Maroubra Junction</span>
        </span>
        {next && next.inMin != null && <span className="bus-next">Next: {next.route} in {next.inMin} min</span>}
      </div>
      {!d.covered ? <p className="muted bus-none">Timetable not loaded for this date: it needs a refresh from Transport for NSW.</p> : (
        <div className="bus-groups">
          {d.groups.map((g) => (
            <div key={g.window.join("-")} className="bus-group">
              <span className="bus-win">{g.window[0]} to {g.window[1]}</span>
              {g.times.length ? g.times.map((x) => (
                <span key={x.t + x.route} className={`bus-time${x.gone ? " gone" : ""}${x.next ? " next" : ""}`}>
                  {x.t}{isExpress(x.route) && <span className="bus-x" aria-hidden="true">X</span>}
                  <span className="sr-only">{` ${x.route}${isExpress(x.route) ? " express" : ""}${x.gone ? ", gone" : ""}`}</span>
                </span>
              )) : <span className="muted">No bus</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
