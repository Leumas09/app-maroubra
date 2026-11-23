import { afterEach, describe, expect, it, vi } from "vitest";
import { foundryLlm } from "../src/llm";
import { archiveSurfLook, memoryArchive } from "../src/archive";
import { LOOKS_PER_DAY, inMorningWindow, overall, readAnswer, shouldLook, surfWatchCollector, type FetchCam } from "../src/sources/surf-watch";
import { Store } from "../src/store";

// 24 novembre 2026 à Sydney (UTC+11) : lever du Soleil vers 05:37.
const sydney = (hhmm: string, day = "2026-11-24") => new Date(`${day}T${hhmm}:00+11:00`);
const jpeg = new Uint8Array(130_000).fill(7);
const cams: FetchCam = async () => jpeg;
const answer = (north: string, south: string) => ({ north: { crowd: north, note: "four sitting off the rocks." }, south: { crowd: south, note: "" } });

describe("surfeurs à l'eau : quand lire les caméras", () => {
  it("seulement de la première lumière à 9 h", () => {
    expect(inMorningWindow(sydney("03:00"))).toBe(false); // nuit
    expect(inMorningWindow(sydney("05:30"))).toBe(true); // quelques minutes avant le lever
    expect(inMorningWindow(sydney("08:59"))).toBe(true);
    expect(inMorningWindow(sydney("09:00"))).toBe(false);
    expect(inMorningWindow(sydney("15:00"))).toBe(false);
  });
  it("une lecture toutes les 30 min au plus, et jamais plus que le plafond du jour", () => {
    const now = sydney("07:00");
    expect(shouldLook({ day: "", looks: 0, lastLookMs: null }, now)).toBe(true);
    expect(shouldLook({ day: "2026-11-24", looks: 1, lastLookMs: now.getTime() - 29 * 60e3 }, now)).toBe(false);
    expect(shouldLook({ day: "2026-11-24", looks: 1, lastLookMs: now.getTime() - 30 * 60e3 }, now)).toBe(true);
    expect(shouldLook({ day: "2026-11-24", looks: LOOKS_PER_DAY, lastLookMs: null }, now)).toBe(false);
    // Le plafond repart à zéro le lendemain.
    expect(shouldLook({ day: "2026-11-23", looks: LOOKS_PER_DAY, lastLookMs: null }, now)).toBe(true);
  });
  it("un matin entier ne dépasse pas le plafond, même en passant toutes les 5 minutes", async () => {
    let calls = 0;
    const col = surfWatchCollector({ look: async () => { calls++; return { json: answer("few", "none"), usage: { inputTokens: 2800, outputTokens: 350 } }; } }, { fetchCam: cams });
    const store = new Store();
    let out = await col.run({ store, now: sydney("00:00") });
    for (let m = 0; m < 24 * 60; m += 5) out = await col.run({ store, now: new Date(sydney("00:00").getTime() + m * 60e3) });
    expect(calls).toBeGreaterThan(4);
    expect(calls).toBeLessThanOrEqual(LOOKS_PER_DAY);
    expect(out.budget).toMatchObject({ day: "2026-11-24", looks: calls, cap: LOOKS_PER_DAY, inputTokens: calls * 2800, outputTokens: calls * 350 });
    expect(out.crowd).toBe("few");
    expect(new Date(out.at!).getTime()).toBeLessThan(sydney("09:00").getTime());
  });
});

describe("surfeurs à l'eau : lecture", () => {
  it("garde le plus fort des deux bouts de plage, « unclear » seulement si rien n'est lisible", () => {
    expect(overall([{ crowd: "none" }, { crowd: "few" }])).toBe("few");
    expect(overall([{ crowd: "unclear" }, { crowd: "none" }])).toBe("none");
    expect(overall([{ crowd: "many" }, { crowd: "few" }])).toBe("many");
    expect(overall([{ crowd: "unclear" }, { crowd: "unclear" }])).toBe("unclear");
  });
  it("ne fait pas confiance à une réponse mal formée, ni à une caméra non envoyée", () => {
    expect(readAnswer({ north: { crowd: "lots", note: 3 }, south: { crowd: "many", note: "a dozen out the back" } }, ["north", "south"]))
      .toEqual([{ id: "north", crowd: "unclear", note: "" }, { id: "south", crowd: "many", note: "a dozen out the back" }]);
    expect(readAnswer(answer("few", "many"), ["north"])[1]).toEqual({ id: "south", crowd: "unclear", note: "Camera image unavailable" });
    expect(readAnswer(null, ["north", "south"]).map((c) => c.crowd)).toEqual(["unclear", "unclear"]);
  });
  it("ne paie rien sans modèle, la nuit, ou quand aucune caméra ne répond", async () => {
    const store = new Store();
    expect((await surfWatchCollector(null, { fetchCam: cams }).run({ store, now: sydney("07:00") })).at).toBeNull();
    let calls = 0;
    const look = async () => { calls++; return { json: answer("few", "few"), usage: { inputTokens: 1, outputTokens: 1 } }; };
    await surfWatchCollector({ look }, { fetchCam: cams }).run({ store, now: sydney("22:00") });
    const off = await surfWatchCollector({ look }, { fetchCam: async () => null }).run({ store, now: sydney("07:00") });
    expect(calls).toBe(0);
    expect(off.budget.looks).toBe(0);
  });
  it("une lecture ratée compte dans le plafond et dans les jetons", async () => {
    const col = surfWatchCollector({ look: async () => { throw Object.assign(new Error("model answer is not JSON"), { usage: { inputTokens: 2800, outputTokens: 1000 } }); } }, { fetchCam: cams });
    const store = new Store();
    await expect(col.run({ store, now: sydney("07:00") })).rejects.toThrow("not JSON");
    const next = await col.run({ store, now: sydney("07:05") }); // pas de nouvel essai avant 30 min
    expect(next.budget).toMatchObject({ looks: 1, inputTokens: 2800, outputTokens: 1000 });
    expect(next.at).toBeNull();
  });
  it("archive chaque lecture avec son image, découpée pour Table Storage", async () => {
    const table = memoryArchive();
    const looks: Parameters<typeof archiveSurfLook>[1][] = [];
    const col = surfWatchCollector({ look: async () => ({ json: answer("few", "none"), usage: { inputTokens: 2800, outputTokens: 350 } }) }, { fetchCam: cams, onLook: (l) => looks.push(l) });
    await col.run({ store: new Store(), now: sydney("07:00") });
    await archiveSurfLook(table, looks[0]);
    const rows = await table.partition("surf-202611");
    expect(rows).toHaveLength(2);
    const north = rows.find((r) => r.cam === "north")!;
    expect(north).toMatchObject({ crowd: "few", note: "four sitting off the rocks.", bytes: 130_000, inputTokens: 2800 });
    const parts = [north.jpeg0, north.jpeg1, north.jpeg2] as Uint8Array[];
    expect(parts.map((p) => p.length)).toEqual([60_000, 60_000, 10_000]);
    expect(north.jpeg3).toBeUndefined();
  });
});

describe("appel du modèle avec des images (API Responses)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const credential = { getToken: async () => ({ token: "t", expiresOnTimestamp: 0 }) };
  it("envoie les images en JPEG base64, détail haut, avec un schéma strict, et rend les jetons facturés", async () => {
    let body: any;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ output_text: JSON.stringify(answer("few", "none")), usage: { input_tokens: 2810, output_tokens: 340 } }), { status: 200 });
    });
    const r = await foundryLlm("https://example.invalid/", "gpt-6.1-sol", credential).look("Look.", [{ label: "Image north", jpeg: new Uint8Array([0xff, 0xd8, 0xff]) }], { name: "surfers", schema: { type: "object" } });
    expect(r).toEqual({ json: answer("few", "none"), usage: { inputTokens: 2810, outputTokens: 340 } });
    expect(body.model).toBe("gpt-6.1-sol");
    expect(body.max_output_tokens).toBe(1000);
    expect(body.input[0].content).toEqual([{ type: "input_text", text: "Image north" }, { type: "input_image", image_url: "data:image/jpeg;base64,/9j/", detail: "high" }]);
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "surfers", strict: true });
  });
  it("une réponse coupée est une erreur qui garde ses jetons", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ output: [], usage: { input_tokens: 2810, output_tokens: 1000 } }), { status: 200 }));
    await expect(foundryLlm("https://example.invalid", "m", credential).look("Look.", [], { name: "x", schema: {} })).rejects.toMatchObject({ usage: { inputTokens: 2810, outputTokens: 1000 } });
  });
});
