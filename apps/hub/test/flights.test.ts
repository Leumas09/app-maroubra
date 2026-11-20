import { describe, expect, it } from "vitest";
import { moments } from "../src/derive/moments";
import { okPhotoUrl, parsePhoto, photoFinder } from "../src/photos";
import { airlineOf } from "../src/sources/airlines";
import { currentLeg, emergencyOf, normalize, type RawAc } from "../src/sources/flights";
import type { Config } from "../src/config";
import { createApp } from "../src/server";
import { Store } from "../src/store";

// Données construites à la main, au format de l'API v2 d'adsb.lol et du service routeset.
const SYD = { iata: "SYD", icao: "YSSY", name: "Sydney", location: "Sydney", lat: -33.9461, lon: 151.1772 };
const DXB = { iata: "DXB", icao: "OMDB", name: "Dubai", location: "Dubai", lat: 25.2528, lon: 55.3644 };
const LHR = { iata: "LHR", icao: "EGLL", name: "Heathrow", location: "London", lat: 51.47, lon: -0.4543 };

describe("compagnie et numéro de vol", () => {
  it("déduit le numéro commercial de l'indicatif", () => {
    expect(airlineOf("QFA1")).toMatchObject({ airline: { name: "Qantas", iata: "QF" }, flightNo: "QF1" });
    expect(airlineOf("JST512").flightNo).toBe("JQ512");
    expect(airlineOf("VOZ0821").flightNo).toBe("VA821");
  });
  it("ne devine pas un numéro quand la compagnie numérote autrement", () => {
    expect(airlineOf("QLK123D")).toMatchObject({ airline: { name: "QantasLink" }, flightNo: null });
    expect(airlineOf("VHSTR")).toEqual({ airline: null, flightNo: null });
    expect(airlineOf(null)).toEqual({ airline: null, flightNo: null });
  });
});

describe("urgences", () => {
  it("lit le champ emergency de readsb, puis les codes 7500, 7600, 7700", () => {
    expect(emergencyOf({ emergency: "lifeguard" })).toBe("Medical emergency");
    expect(emergencyOf({ emergency: "none", squawk: "7700" })).toBe("General emergency");
    expect(emergencyOf({ squawk: "7600" })).toBe("Radio failure");
    expect(emergencyOf({ emergency: "none", squawk: "3012" })).toBeNull();
  });
  it("une urgence à moins de 60 km devient un moment prioritaire, une seule fois par jour", () => {
    const raw: RawAc[] = [{ hex: "7c533a", flight: "JST512", t: "A321", squawk: "7700", emergency: "general", alt_baro: 12000, gs: 320, track: 200, lat: -33.8, lon: 151.3, seen_pos: 1 }];
    const now = new Date("2026-11-14T03:00:00Z");
    const list = moments({ flights: { aircraft: normalize(raw, new Map(), new Map(), now.getTime()), runway: null, curfew: false, seenToday: 0 } }, now);
    expect(list[0]).toMatchObject({ kind: "plane", priority: 1, key: "emergency-7c533a-General emergency-2026-11-14" });
    expect(list[0].title).toBe("JQ512: General emergency (squawk 7700)");
  });
});

describe("étape en cours et avancement", () => {
  it("choisit l'étape SYD-DXB d'un SYD-DXB-LHR au départ de Sydney", () => {
    const leg = currentLeg([SYD, DXB, LHR], -33.95, 151.0);
    expect(leg.from?.iata).toBe("SYD");
    expect(leg.to?.iata).toBe("DXB");
    expect(leg.progress!.pct).toBeLessThan(2);
    expect(leg.progress!.leftKm).toBeGreaterThan(11_000);
  });
  it("choisit DXB-LHR au-dessus de l'Europe", () => {
    const leg = currentLeg([SYD, DXB, LHR], 45.0, 20.0);
    expect(leg.from?.iata).toBe("DXB");
    expect(leg.progress!.pct).toBeGreaterThan(50);
  });
  it("sans coordonnées d'aéroport : pas d'avancement, mais la route reste", () => {
    const routes = new Map([["QFA1", { callsign: "QFA1", airport_codes: "YSSY-EGLL", _airport_codes_iata: "SYD-LHR", plausible: true, _airports: [{ iata: "SYD", name: "S", location: "Sydney" }, { iata: "LHR", name: "H", location: "London" }] }]]);
    const [a] = normalize([{ hex: "7c0001", flight: "QFA1", alt_baro: 5000, gs: 250, track: 90, lat: -33.95, lon: 151.2, seen_pos: 2 }], routes as never, new Map(), 1_000_000);
    expect(a.route?.codes).toBe("SYD-LHR");
    expect(a.progress).toBeNull();
    expect(a.posAt).toBe(998_000);
    expect(a.flightNo).toBe("QF1");
  });
  it("garde type, catégorie, source de position et squawk", () => {
    const [a] = normalize([{ hex: "7c81b5", t: "A139", desc: "AGUSTAWESTLAND AW-139", category: "A7", type: "mlat", squawk: "1000", year: "2015", alt_baro: 900, lat: -33.97, lon: 151.27, seen_pos: 1 }], new Map(), new Map());
    expect(a).toMatchObject({ category: "A7", source: "MLAT", squawk: "1000", desc: "AGUSTAWESTLAND AW-139", built: 2015, emergency: null });
  });
});

describe("photos Planespotters", () => {
  const ok = { photos: [{ thumbnail_large: { src: "https://t.plnspttrs.net/12345/1234567_abcd_280.jpg", size: { width: 420, height: 280 } }, link: "https://www.planespotters.net/photo/1234567/vh-oqa", photographer: "A. Spotter" }] };
  it("n'accepte que des images servies par Planespotters", () => {
    expect(parsePhoto(ok)).toEqual({ src: ok.photos[0].thumbnail_large.src, width: 420, height: 280, link: ok.photos[0].link, photographer: "A. Spotter" });
    expect(okPhotoUrl("https://evil.example/plnspttrs.net.jpg")).toBe(false);
    expect(okPhotoUrl("http://t.plnspttrs.net/x.jpg")).toBe(false);
    expect(parsePhoto({ photos: [] })).toBeNull();
  });
  it("cherche par immatriculation si l'adresse ne donne rien, et garde la réponse en cache", async () => {
    const calls: string[] = [];
    const find = photoFinder(async (u) => { calls.push(u); return u.includes("/reg/") ? ok : { photos: [] }; });
    expect((await find("7c0001", "VH-OQA"))?.photographer).toBe("A. Spotter");
    await find("7c0001", "VH-OQA");
    expect(calls).toEqual(["https://api.planespotters.net/pub/photos/hex/7c0001", "https://api.planespotters.net/pub/photos/reg/VH-OQA"]);
  });
});

describe("route /api/aircraft/:hex/photo", () => {
  const cfg: Config = { port: 0, staticDir: "/nonexistent", password: "test-family-password", sessionSecret: "s", secureCookies: false, version: "t", offline: true, foundry: { deployment: "x" }, vapid: { subject: "mailto:x@y" } };
  const session = async (app: ReturnType<typeof createApp>) => {
    const r = await app.request("/login", { method: "POST", body: new URLSearchParams({ password: "test-family-password", next: "/" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    return { cookie: `mb_s=${r.headers.get("set-cookie")!.match(/mb_s=([^;]+)/)![1]}` };
  };
  it("exige une session, valide l'adresse et renvoie la photo", async () => {
    const app = createApp(cfg, new Store(), { photos: async (hex, reg) => ({ src: `https://t.plnspttrs.net/${hex}.jpg`, width: 3, height: 2, link: "https://www.planespotters.net/p", photographer: reg ?? "?" }) });
    expect((await app.request("/api/aircraft/7c0001/photo")).status).toBe(401);
    const headers = await session(app);
    expect((await app.request("/api/aircraft/zzzzzz/photo", { headers })).status).toBe(400);
    expect((await app.request("/api/aircraft/7c0001/photo?reg=<x>", { headers })).status).toBe(400);
    const r = await app.request("/api/aircraft/7C0001/photo?reg=vh-oqa", { headers });
    expect((await r.json()).photo).toMatchObject({ src: "https://t.plnspttrs.net/7c0001.jpg", photographer: "VH-OQA" });
  });
  it("autorise les tuiles de carte et les photos dans la CSP, rien d'autre", async () => {
    const csp = (await createApp(cfg, new Store()).request("/health")).headers.get("content-security-policy")!;
    expect(csp).toContain("img-src 'self' data: blob: https://www.randwick.nsw.gov.au https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://*.plnspttrs.net");
    expect(csp).toContain("connect-src 'self';");
  });
});
