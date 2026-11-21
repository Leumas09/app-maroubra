import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { moments } from "../src/derive/moments";
import { okPhotoUrl, parsePhoto, photoFinder } from "../src/photos";
import { airlineOf } from "../src/sources/airlines";
import { FlightHistory } from "../src/sources/history";
import { parseAdsbdb, routeLookup } from "../src/sources/routes";
import { parseAdsbdbPhoto, parseWikiPhoto } from "../src/photos";
import { aircraftList, areaFinder, currentLeg, emergencyOf, flightsCollector, normalize, type RawAc } from "../src/sources/flights";
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
    expect(parsePhoto(ok)).toEqual({ kind: "exact", site: "Planespotters", src: ok.photos[0].thumbnail_large.src, width: 420, height: 280, link: ok.photos[0].link, photographer: "A. Spotter" });
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
    expect(csp).toContain("img-src 'self' data: blob: https://www.randwick.nsw.gov.au https://tile.openstreetmap.org https://server.arcgisonline.com https://*.plnspttrs.net");
    expect(csp).toContain("connect-src 'self' https://*.secdn.net;");
  });
});

describe("source des positions : adsb.fi, adsb.lol en secours", () => {
  const fi = JSON.parse(readFileSync(new URL("./fixtures/adsbfi-point-2026-11-20.json", import.meta.url), "utf8"));
  it("lit une vraie réponse d'adsb.fi (liste sous « aircraft »)", () => {
    const acs = normalize(aircraftList(fi), new Map(), new Map(), fi.now);
    expect(acs).toHaveLength(6);
    const va = acs.find((a) => a.callsign === "VOZ829")!;
    expect(va).toMatchObject({ type: "B38M", flightNo: "VA829", source: "ADS-B", airline: { name: "Virgin Australia" } });
    expect(acs.find((a) => a.type === "R22")!.source).toBe("MLAT");
    expect(aircraftList({ ac: [] })).toEqual([]);
  });

  it("bascule sur adsb.lol si adsb.fi tombe, au plus une fois toutes les 5 min", { timeout: 30_000 }, async () => {
    const calls: string[] = [];
    let fiUp = false;
    vi.stubGlobal("fetch", async (u: string) => {
      calls.push(new URL(u).host);
      if (u.includes("adsb.fi") && !fiUp) return new Response("down", { status: 503 });
      if (u.includes("routeset")) return new Response("[]");
      return new Response(JSON.stringify(u.includes("adsb.fi") ? fi : { ac: fi.aircraft }));
    });
    try {
      const col = flightsCollector();
      const t0 = new Date("2026-11-20T23:00:00Z");
      expect((await col.run({ now: t0 } as never)).source).toBe("adsb.lol");
      await expect(col.run({ now: new Date(t0.getTime() + 10e3) } as never)).rejects.toThrow(/503/);
      expect((await col.run({ now: new Date(t0.getTime() + 301e3) } as never)).source).toBe("adsb.lol");
      fiUp = true;
      const ok = await col.run({ now: new Date(t0.getTime() + 311e3) } as never);
      expect(ok.source).toBe("adsb.fi");
      expect(ok.aircraft).toHaveLength(6);
      // adsb.lol ne sert plus qu'au secours des positions (les routes viennent d'adsbdb)
      expect(calls.filter((h) => h === "api.adsb.lol").length).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("collecteurs dérivés en attente d'une entrée", () => {
  it("n'affichent pas de panne et réessaient 15 s plus tard", async () => {
    vi.useFakeTimers();
    try {
      const { startCollectors, Waiting } = await import("../src/collector");
      const store = new Store();
      let ready = false, runs = 0;
      const stop = startCollectors(store, [{ id: "beach", everyMs: 10 * 60e3, staleAfterMs: 3600e3, run: async () => { runs++; if (!ready) throw new Waiting("weather"); return { ok: 1 }; } }]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(store.health().beach).toMatchObject({ ok: false, error: null });
      ready = true;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(runs).toBe(2);
      expect(store.health().beach.ok).toBe(true);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("avions de la zone visible sur la carte", () => {
  const fi = JSON.parse(readFileSync(new URL("./fixtures/adsbfi-point-2026-11-20.json", import.meta.url), "utf8"));
  it("arrondit la zone, borne le rayon à 250 NM et partage le cache quelques secondes", async () => {
    const asked: string[] = [];
    const find = areaFinder({ routes: new Map(), history: new FlightHistory(), lookup: () => [] }, async (u) => { asked.push(u); return fi; });
    expect(await find(-33.512, 150.987, 37)).toHaveLength(6);
    await find(-33.509, 150.99, 38); // même zone une fois arrondie
    await find(-30, 150, 900);
    expect(asked).toEqual([
      "https://opendata.adsb.fi/api/v2/lat/-33.5/lon/151/dist/40",
      "https://opendata.adsb.fi/api/v2/lat/-30/lon/150/dist/250",
    ]);
  });
  it("route /api/aircraft/area : session exigée, zone validée", async () => {
    const cfg: Config = { port: 0, staticDir: "/nonexistent", password: "test-family-password", sessionSecret: "s", secureCookies: false, version: "v1", offline: true, foundry: { deployment: "x" }, vapid: { subject: "mailto:x@y" } };
    const app = createApp(cfg, new Store(), { area: async (lat, lon, r) => normalize(aircraftList(fi), new Map(), new Map()).slice(0, Math.round(r / 100)) });
    expect((await app.request("/api/aircraft/area?lat=-33&lon=151&r=200")).status).toBe(401);
    const r = await app.request("/login", { method: "POST", body: new URLSearchParams({ password: "test-family-password", next: "/" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const headers = { cookie: `mb_s=${r.headers.get("set-cookie")!.match(/mb_s=([^;]+)/)![1]}` };
    expect((await app.request("/api/aircraft/area?lat=x&lon=151&r=20", { headers })).status).toBe(400);
    expect((await app.request("/api/aircraft/area?lat=-33&lon=151&r=0", { headers })).status).toBe(400);
    expect((await (await app.request("/api/aircraft/area?lat=-33&lon=151&r=200", { headers })).json()).aircraft).toHaveLength(2);
    // la version servie accompagne l'état, pour le rechargement automatique de l'app
    expect((await (await app.request("/api/state", { headers })).json()).build).toBe("v1");
  });
});

describe("traces : historique des positions", () => {
  const at = (s: number) => 1_800_000_000_000 + s * 1000;
  it("garde un point toutes les 8 s au plus, et la trace des 10 dernières minutes pour la carte", () => {
    const h = new FlightHistory();
    for (let s = 0; s <= 900; s += 5) h.add([{ hex: "abc123", lat: -33.9 + s * 1e-4, lon: 151.2, alt_baro: 5000 }], at(s));
    expect(h.trace("abc123").length).toBeLessThan(120);
    expect(h.recent("abc123", at(900)).length).toBeLessThan(h.trace("abc123").length);
    expect(h.tookOffAt("abc123")).toBeNull();
  });
  it("voit le décollage : la trace repart de la piste et l'heure est retenue", () => {
    const h = new FlightHistory();
    h.add([{ hex: "7c0001", lat: -33.95, lon: 151.17, alt_baro: "ground" }], at(0));
    h.add([{ hex: "7c0001", lat: -33.96, lon: 151.17, alt_baro: "ground" }], at(20));
    h.add([{ hex: "7c0001", lat: -33.98, lon: 151.17, alt_baro: 800 }], at(40));
    expect(h.tookOffAt("7c0001")).toBe(at(40));
    expect(h.trace("7c0001").map((p) => p[3])).toEqual([null, 800]);
  });
  it("oublie un avion parti depuis plus de 3 h", () => {
    const h = new FlightHistory();
    h.add([{ hex: "abc123", lat: -33.9, lon: 151.2, alt_baro: 5000 }], at(0));
    h.prune(at(4 * 3600));
    expect(h.size).toBe(0);
  });
  it("route /api/aircraft/:hex/trace", async () => {
    const h = new FlightHistory();
    h.add([{ hex: "7c0001", lat: -33.95, lon: 151.17, alt_baro: 3000 }], Date.now());
    const cfg: Config = { port: 0, staticDir: "/nonexistent", password: "test-family-password", sessionSecret: "s", secureCookies: false, version: "v1", offline: true, foundry: { deployment: "x" }, vapid: { subject: "mailto:x@y" } };
    const app = createApp(cfg, new Store(), { history: h });
    const r = await app.request("/login", { method: "POST", body: new URLSearchParams({ password: "test-family-password", next: "/" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const headers = { cookie: `mb_s=${r.headers.get("set-cookie")!.match(/mb_s=([^;]+)/)![1]}` };
    expect((await (await app.request("/api/aircraft/7c0001/trace", { headers })).json()).points).toHaveLength(1);
    expect((await app.request("/api/aircraft/zz/trace", { headers })).status).toBe(400);
  });
});

describe("routes adsbdb", () => {
  // Réponse réelle d'adsbdb du 21/11/2026 pour QFA1, réduite aux champs lus.
  const qfa1 = JSON.stringify({ response: { flightroute: { callsign: "QFA1", origin: { iata_code: "SYD", icao_code: "YSSY", latitude: -33.9461, longitude: 151.177, municipality: "Sydney", name: "Sydney Kingsford Smith International Airport" }, destination: { iata_code: "SIN", icao_code: "WSSS", latitude: 1.35019, longitude: 103.994, municipality: "Singapore", name: "Singapore Changi Airport" } } } });
  it("lit origine et destination avec leurs coordonnées", () => {
    const r = parseAdsbdb(qfa1, "QFA1", 1)!;
    expect(r._airport_codes_iata).toBe("SYD-SIN");
    expect(r._airports[1]).toMatchObject({ iata: "SIN", location: "Singapore", lat: 1.35019 });
    expect(parseAdsbdb(JSON.stringify({ response: "unknown callsign" }), "ZZZ1", 1)).toBeNull();
  });
  it("cherche chaque indicatif une fois, quelques-uns à la fois, et retient les inconnus", async () => {
    const cache = new Map();
    const asked: string[] = [];
    const lookup = routeLookup(cache, async (u) => { asked.push(u.split("/").at(-1)!); return u.endsWith("QFA1") ? { status: 200, body: qfa1 } : { status: 404, body: "" }; });
    expect(lookup(["QFA1", "QFA1", "ZZZ1", "", "bad cs"], 5)).toEqual(["QFA1", "ZZZ1"]);
    await new Promise((r) => setTimeout(r, 1200));
    expect(asked).toEqual(["QFA1", "ZZZ1"]);
    expect(lookup(["QFA1", "ZZZ1"])).toEqual([]);
    expect(cache.get("QFA1")._airport_codes_iata).toBe("SYD-SIN");
    expect(cache.get("ZZZ1").unknown).toBe(true);
  });
});

describe("photos de secours", () => {
  it("adsbdb : photo d'airport-data.com seulement", () => {
    expect(parseAdsbdbPhoto({ response: { aircraft: { url_photo: "https://image.airport-data.com/aircraft/001673009.jpg", registration: "VH-VGF" } } })).toMatchObject({ kind: "exact", site: "airport-data.com" });
    expect(parseAdsbdbPhoto({ response: { aircraft: { url_photo: "https://evil.example/x.jpg" } } })).toBeNull();
  });
  it("Wikipédia : photo du modèle, marquée comme telle, avec lien vers le fichier", () => {
    const p = parseWikiPhoto({ query: { pages: [{ title: "Cessna 152", thumbnail: { source: "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e8/G-BRNE-Cessna152.jpg/960px-G-BRNE-Cessna152.jpg", width: 640, height: 421 }, pageimage: "G-BRNE-Cessna152.jpg" }] } }, "CESSNA 152");
    expect(p).toMatchObject({ kind: "type", typeName: "CESSNA 152", link: "https://en.wikipedia.org/wiki/File:G-BRNE-Cessna152.jpg" });
  });
  it("enchaîne Planespotters, adsbdb puis Wikipédia", async () => {
    const asked: string[] = [];
    const find = photoFinder(async (u) => {
      asked.push(new URL(u).host);
      if (u.includes("wikipedia")) return { query: { pages: [{ title: "Cessna 152", thumbnail: { source: "https://upload.wikimedia.org/x.jpg", width: 4, height: 3 }, pageimage: "x.jpg" }] } };
      return {};
    });
    expect((await find("7c3f11", "VH-STR", "CESSNA 152"))?.kind).toBe("type");
    expect(asked).toEqual(["api.planespotters.net", "api.planespotters.net", "api.adsbdb.com", "en.wikipedia.org"]);
  });
});
