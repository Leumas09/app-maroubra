import { describe, expect, it } from "vitest";
import table from "../src/data/bus.json";
import { busDay, normalizeWindows, type BusTable, type BusWindow } from "../src/lib/bus";

const t = table as unknown as BusTable;
// Heures de Sydney (UTC+11 de novembre à début avril).
const at = (local: string) => new Date(`${local}+11:00`);
const label = (x: { t: string; route: string }) => (x.route === "396X" ? `${x.t}X` : x.t);
const shown = (d: ReturnType<typeof busDay>) => d.groups.map((g) => g.times.map(label));

describe("bus 396 et 396X", () => {
  it("un lundi à 7 h 30 : les deux lignes mêlées par heure, les bus passés grisés, le prochain mis en avant", () => {
    const d = busDay(t, at("2026-11-23T07:30:00"));
    expect(d).toMatchObject({ date: "2026-11-23", today: true, covered: true });
    expect(shown(d)).toEqual([
      ["07:19", "07:21X", "07:26", "07:31X", "07:35", "07:39X", "07:43"],
      ["08:18X", "08:25", "08:30X", "08:35", "08:41X", "08:51", "09:03", "09:13"],
    ]);
    expect(d.groups[0].times.filter((x) => x.gone).map(label)).toEqual(["07:19", "07:21X", "07:26"]);
    expect(d.groups.flatMap((g) => g.times).find((x) => x.next)).toMatchObject({ t: "07:31", route: "396X", inMin: 1 });
  });
  it("la deuxième plage va maintenant jusqu'à 9 h 15 : à 8 h 50 on reste sur le jour même", () => {
    const d = busDay(t, at("2026-11-23T08:50:00"));
    expect(d).toMatchObject({ date: "2026-11-23", today: true });
    expect(d.groups.flatMap((g) => g.times).find((x) => x.next)).toMatchObject({ t: "08:51", route: "396", inMin: 1 });
  });
  it("un lundi après 9 h 15 : les horaires du mardi", () => {
    expect(busDay(t, at("2026-11-23T09:16:00"))).toMatchObject({ date: "2026-11-24", today: false });
  });
  it("le vendredi soir et tout le week-end : ceux du lundi", () => {
    expect(busDay(t, at("2026-11-27T18:00:00")).date).toBe("2026-11-30");
    expect(busDay(t, at("2026-11-28T09:00:00")).date).toBe("2026-11-30");
    expect(busDay(t, at("2026-11-29T23:00:00")).date).toBe("2026-11-30");
  });
  it("vacances scolaires : l'horaire du 396 change, le 396X roule toujours", () => {
    expect(shown(busDay(t, at("2027-01-11T06:00:00")))).toEqual([
      ["07:16", "07:21X", "07:24", "07:31X", "07:33", "07:39X", "07:42"],
      ["08:18X", "08:21", "08:30X", "08:31", "08:41", "08:41X", "08:54", "09:04", "09:14"],
    ]);
  });
  it("jour férié (Noël) : pas de 396X", () => {
    const d = busDay(t, at("2026-12-25T06:00:00"));
    expect(d.groups.flatMap((g) => g.times).some((x) => x.route === "396X")).toBe(false);
    expect(shown(d)[0]).toEqual(["07:28"]);
  });
  it("plages réglées dans Settings : celles de l'appareil remplacent celles par défaut, et la bascule suit la dernière", () => {
    const ws: BusWindow[] = [["17:00", "17:30"]];
    const d = busDay(t, at("2026-11-23T16:00:00"), ws);
    expect(d).toMatchObject({ date: "2026-11-23", today: true });
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0].times.every((x) => x.t >= "17:00" && x.t <= "17:30" && x.route === "396")).toBe(true);
    expect(busDay(t, at("2026-11-23T17:31:00"), ws).date).toBe("2026-11-24");
  });
  it("départs après minuit rendus au jour civil (heures GTFS de 24:00 et plus)", () => {
    expect(busDay(t, at("2026-11-23T00:05:00"), [["00:00", "00:30"]]).groups[0].times.map(label)).toEqual(["00:11"]);
  });
});

describe("plages horaires", () => {
  it("triées, chevauchements fusionnés", () => {
    expect(normalizeWindows([["08:15", "09:15"], ["07:15", "07:45"], ["07:40", "08:00"]])).toEqual([["07:15", "08:00"], ["08:15", "09:15"]]);
  });
  it("refusées si vides, à l'envers, mal formées ou trop nombreuses", () => {
    expect(normalizeWindows([])).toBeNull();
    expect(normalizeWindows([["09:00", "08:00"]])).toBeNull();
    expect(normalizeWindows([["9:00", "10:00"]])).toBeNull();
    expect(normalizeWindows([["08:00", ""]])).toBeNull();
    expect(normalizeWindows("07:15")).toBeNull();
    expect(normalizeWindows(Array(5).fill(["07:00", "07:10"]))).toBeNull();
  });
  it("un réglage invalide retombe sur les plages par défaut", () => {
    expect(busDay(t, at("2026-11-23T07:30:00"), [["09:00", "08:00"]]).groups.map((g) => g.window)).toEqual([["07:15", "07:45"], ["08:15", "09:15"]]);
  });
});
