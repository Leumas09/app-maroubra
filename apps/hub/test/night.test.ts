import { afterEach, describe, expect, it, vi } from "vitest";
import { writeBrief, type BriefFacts } from "../src/derive/brief";
import type { Llm } from "../src/llm";
import { dayOnly, isNight } from "../src/night";
import { newsCollector } from "../src/sources/news";
import { Store } from "../src/store";

// Sydney en heure d'été (UTC+11) puis en heure d'hiver (UTC+10).
const sydney = (hhmm: string, day = "2026-11-25", offset = "+11:00") => new Date(`${day}T${hhmm}:00${offset}`);

describe("nuit de l'app : 22 h 30 à 6 h 30, heure de Sydney", () => {
  it("bornes de la nuit", () => {
    expect(isNight(sydney("22:29"))).toBe(false);
    expect(isNight(sydney("22:30"))).toBe(true);
    expect(isNight(sydney("00:00"))).toBe(true);
    expect(isNight(sydney("06:29"))).toBe(true);
    expect(isNight(sydney("06:30"))).toBe(false);
    expect(isNight(sydney("12:00"))).toBe(false);
  });
  it("suit l'heure locale en hiver aussi", () => {
    expect(isNight(sydney("23:00", "2026-07-01", "+10:00"))).toBe(true);
    expect(isNight(sydney("07:00", "2026-07-01", "+10:00"))).toBe(false);
  });
  it("le modèle seulement de jour", () => {
    const llm = { name: "model" };
    expect(dayOnly(llm, sydney("12:00"))).toBe(llm);
    expect(dayOnly(llm, sydney("02:00"))).toBeNull();
    expect(dayOnly(null, sydney("12:00"))).toBeNull();
  });
});

describe("aucun appel au modèle la nuit", () => {
  const facts: BriefFacts = { localTime: "Wednesday 23:00", weather: { now: "clear", tempC: 21, feelsC: 21, windKmh: 10, windFrom: 45, maxToday: 26, rainChanceToday: 10 }, beach: null, tide: null, moments: [] };

  it("brief : par règles la nuit, sans appeler le modèle", async () => {
    let calls = 0;
    const llm = { text: async () => { calls++; return "From the model."; } } as unknown as Llm;
    const now = sydney("23:00");
    const b = await writeBrief(dayOnly(llm, now), facts, now);
    expect(b.by).toBe("rules");
    expect(calls).toBe(0);
    const day = await writeBrief(dayOnly(llm, sydney("09:00")), facts, sydney("09:00"));
    expect(day.by).toBe("model");
    expect(calls).toBe(1);
  });

  afterEach(() => vi.unstubAllGlobals());
  it("actualités : mots-clés la nuit, tri par le modèle au matin", async () => {
    const rss = `<?xml version="1.0"?><rss><channel>
      <item><title>Maroubra Beach closed after shark sighting - The Daily Telegraph</title><link>https://example.com/a</link><pubDate>Tue, 24 Nov 2026 20:00:00 GMT</pubDate><source>The Daily Telegraph</source></item>
      <item><title>Randwick council approves new cycleway - Southern Courier</title><link>https://example.com/b</link><pubDate>Tue, 24 Nov 2026 19:00:00 GMT</pubDate><source>Southern Courier</source></item>
    </channel></rss>`;
    vi.stubGlobal("fetch", async () => new Response(rss, { status: 200 }));
    let calls = 0;
    const llm = {
      triageNews: async (items: { id: string }[]) => { calls++; return items.map((i) => ({ id: i.id, local: true, topic: "Community", summary: "Summary." })); },
    } as unknown as Llm;
    const col = newsCollector(llm);
    const store = new Store();
    const night = await col.run({ store, now: sydney("23:30") });
    expect(calls).toBe(0);
    expect(night.triagedBy).toBe("keywords");
    expect(night.items.length).toBe(2);
    const morning = await col.run({ store, now: sydney("06:40", "2026-11-26") });
    expect(calls).toBe(1);
    expect(morning.triagedBy).toBe("model");
    expect(morning.items[0].summary).toBe("Summary.");
  });
});
