import { describe, expect, it } from "vitest";
import { shapeOf } from "../src/lib/aircraft-shapes";
import { cameraAt, cameraAz, cameraEl, cameraFromOrientation, deadReckon, distanceKm, lookAngles, Motion, project } from "../src/lib/motion";

const base = { lat: -33.95, lon: 151.25, posAt: 1_000_000, speedKt: 300, track: 90, onGround: false };
const ac = (over: object = {}) => ({ hex: "7c0001", callsign: null, reg: null, type: null, desc: null, category: null, operator: null, built: null, altFt: 5000, vrate: null, source: null, squawk: null, distKm: 0, bearing: 0, military: false, interesting: false, rare: null, emergency: null, airline: null, flightNo: null, route: null, progress: null, overhead: null, trail: [], ...base, ...over });

describe("extrapolation des positions", () => {
  it("avance à la vitesse sol dans la direction du cap", () => {
    const [la, lo] = deadReckon(base, base.posAt + 10_000);
    expect(distanceKm(base.lat, base.lon, la, lo)).toBeCloseTo((300 * 1.852 * 10) / 3600, 2); // 1,54 km en 10 s
    expect(lo).toBeGreaterThan(base.lon);
    expect(la).toBeCloseTo(base.lat, 3);
  });
  it("ne prolonge ni un avion au sol, ni une position trop vieille (heure figée des captures)", () => {
    expect(deadReckon({ ...base, onGround: true }, base.posAt + 5000)).toEqual([base.lat, base.lon]);
    expect(deadReckon(base, base.posAt + 600_000)).toEqual([base.lat, base.lon]);
  });
  it("fond l'écart quand une nouvelle position arrive, sans saut", () => {
    const m = new Motion();
    m.update([ac()], base.posAt);
    const before = m.pos("7c0001", base.posAt + 10_000)!;
    // Nouvelle position 300 m plus au nord que l'estimation : l'affichage part de l'ancienne, puis la rejoint.
    m.update([ac({ lat: base.lat + 0.0027, posAt: base.posAt + 10_000, lon: before[1] })], base.posAt + 10_000);
    const same = m.pos("7c0001", base.posAt + 10_000)!;
    expect(distanceKm(before[0], before[1], same[0], same[1])).toBeLessThan(0.001);
    const later = m.pos("7c0001", base.posAt + 12_000)!;
    expect(Math.abs(later[0] - (base.lat + 0.0027))).toBeLessThan(0.0002);
  });
});

describe("géométrie du ciel", () => {
  it("un avion à 10 000 ft juste au-dessus est presque au zénith ; à 40 km il est bas sur l'horizon", () => {
    expect(lookAngles({ lat: -33.95, lon: 151.25 }, -33.9501, 151.25, 10000).el).toBeGreaterThan(85);
    const far = lookAngles({ lat: -33.95, lon: 151.25 }, -33.95, 151.68, 10000);
    expect(far.az).toBeCloseTo(90, 0);
    expect(far.el).toBeGreaterThan(3);
    expect(far.el).toBeLessThan(5);
  });
  it("téléphone vertical tourné vers le nord : même caméra que « regarder au nord, à l'horizon »", () => {
    const c = cameraFromOrientation(0, 90, 0);
    expect(cameraAz(c)).toBeCloseTo(0, 5);
    expect(cameraEl(c)).toBeCloseTo(0, 5);
    // alpha croît dans le sens inverse des aiguilles : alpha 90 regarde vers l'ouest
    expect(cameraAz(cameraFromOrientation(90, 90, 0))).toBeCloseTo(270, 5);
    // basculé vers l'arrière : on regarde plus haut
    expect(cameraEl(cameraFromOrientation(0, 120, 0))).toBeCloseTo(30, 5);
  });
  it("le cap boussole d'iOS et le réglage à la main font tourner la vue autour de la verticale", () => {
    expect(cameraAz(cameraFromOrientation(123, 100, 0, { heading: 45 }))).toBeCloseTo(45, 5);
    expect(cameraAz(cameraFromOrientation(0, 90, 0, { yawOffset: 10 }))).toBeCloseTo(10, 5);
    expect(cameraEl(cameraFromOrientation(123, 100, 0, { heading: 45 }))).toBeCloseTo(10, 5);
  });
  it("projette au centre ce qui est droit devant, à droite ce qui est plus à l'est", () => {
    const c = cameraAt(90, 20);
    const mid = project(c, 90, 20, 400, 800, 60)!;
    expect(mid.x).toBeCloseTo(200, 6);
    expect(mid.y).toBeCloseTo(400, 6);
    expect(project(c, 100, 20, 400, 800, 60)!.x).toBeGreaterThan(200);
    expect(project(c, 90, 30, 400, 800, 60)!.y).toBeLessThan(400);
    expect(project(c, 270, 0, 400, 800, 60)).toBeNull(); // derrière
  });
});

describe("silhouettes", () => {
  it("choisit selon le type, puis la catégorie", () => {
    expect(shapeOf({ type: "A388", category: "A5" })).toBe("heavy");
    expect(shapeOf({ type: "B789", category: null })).toBe("wide");
    expect(shapeOf({ type: "DH8D", category: "A2" })).toBe("turboprop");
    expect(shapeOf({ type: "A139", category: null })).toBe("heli");
    expect(shapeOf({ type: "ZZZZ", category: "A7" })).toBe("heli");
    expect(shapeOf({ type: null, category: null })).toBe("narrow");
  });
});
