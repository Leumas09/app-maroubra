import { describe, expect, it } from "vitest";
import table from "../src/data/bus-396.json";
import { busDay, type BusTable } from "../src/lib/bus";

const t = table as unknown as BusTable;
// Heures de Sydney (UTC+11 en novembre).
const at = (local: string) => new Date(`${local}+11:00`);

describe("bus 396 du matin", () => {
  it("un lundi à 7 h 30 : les horaires du jour, les bus passés grisés, le prochain mis en avant", () => {
    const d = busDay(t, at("2026-11-23T07:30:00"));
    expect(d).toMatchObject({ date: "2026-11-23", today: true, covered: true });
    expect(d.times.map((x) => x.t)).toEqual(["07:19", "07:26", "07:35", "07:43", "08:25", "08:35"]);
    expect(d.times.filter((x) => x.gone).map((x) => x.t)).toEqual(["07:19", "07:26"]);
    expect(d.times.find((x) => x.next)).toMatchObject({ t: "07:35", inMin: 5 });
  });
  it("un lundi après 8 h 45 : les horaires du mardi", () => {
    expect(busDay(t, at("2026-11-23T08:46:00"))).toMatchObject({ date: "2026-11-24", today: false });
  });
  it("le vendredi soir et tout le week-end : ceux du lundi", () => {
    expect(busDay(t, at("2026-11-27T18:00:00")).date).toBe("2026-11-30");
    expect(busDay(t, at("2026-11-28T09:00:00")).date).toBe("2026-11-30");
    expect(busDay(t, at("2026-11-29T23:00:00")).date).toBe("2026-11-30");
  });
  it("vacances scolaires : l'horaire change (service de vacances du 21/12)", () => {
    expect(busDay(t, at("2027-01-11T06:00:00")).times.map((x) => x.t)).toEqual(["07:16", "07:24", "07:33", "07:42", "08:21", "08:31", "08:41"]);
  });
});
