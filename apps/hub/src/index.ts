import { serve } from "@hono/node-server";
import type { Beach, Buoy, Fires, Flights, Iss, Marine, Moment, SpaceWeather, Sunrise, Weather } from "@maroubra/core";
import { archiveHour, archiveOutcome, archiveSunriseSky, archiveReader, archiveVote, memoryArchive, tableArchive, type ArchiveTable } from "./archive";
import { startCollectors, type Collector } from "./collector";
import { loadConfig } from "./config";
import { beach } from "./derive/beach";
import { facts, writeBrief } from "./derive/brief";
import { due, moments } from "./derive/moments";
import { sunrise } from "./derive/sunrise";
import { loadTide } from "./derive/tide";
import { verify } from "./derive/verify";
import { foundryLlm } from "./llm";
import { Push } from "./push";
import { createApp } from "./server";
import { flightsCollector } from "./sources/flights";
import { air, fires, space } from "./sources/hazards";
import { issCollector } from "./sources/iss";
import { newsCollector } from "./sources/news";
import { satelliteCollector } from "./sources/himawari";
import { buoy, buoyForecast, marine } from "./sources/sea";
import { airportForecast, metar, weather } from "./sources/weather";
import { Store } from "./store";
import { azureCredential, table } from "./tables";

const cfg = loadConfig();
const store = new Store();
const tide = loadTide(cfg.staticDir);
const llm = cfg.foundry.endpoint ? foundryLlm(cfg.foundry.endpoint, cfg.foundry.deployment, azureCredential(cfg.managedIdentityClientId)) : null;
const push = cfg.vapid.publicKey && cfg.vapid.privateKey
  ? new Push({ publicKey: cfg.vapid.publicKey, privateKey: cfg.vapid.privateKey, subject: cfg.vapid.subject }, table(cfg.tableEndpoint, "push", cfg.managedIdentityClientId))
  : null;
await push?.load();

// Archive : Table Storage en production, mémoire en local (le Track record vivant fonctionne aussi en développement).
const archiveClient = table(cfg.tableEndpoint, "archive", cfg.managedIdentityClientId);
const archive: ArchiveTable | null = archiveClient ? tableArchive(archiveClient) : cfg.offline ? null : memoryArchive();
const loadArchive = archive ? archiveReader(archive) : null;

// Dernière image satellite, servie par /api/satellite.png.
let satellitePng: Buffer | null = null;

const tideNext = (now: Date) => {
  const e = tide.find((x) => x.t * 1000 > now.getTime());
  return e ? `${e.kind} tide at ${new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(e.t * 1000)}` : null;
};

// Calculs dérivés, eux aussi des « collecteurs » : ils lisent l'état et publient leur résultat.
const derived: Collector[] = [
  {
    id: "beach", everyMs: 10 * 60e3, staleAfterMs: 2 * 3600e3,
    run: async ({ store: s, now }) => {
      const w = s.data<Weather>("weather");
      if (!w) throw new Error("waiting for weather");
      return beach(w, s.data<Marine>("marine"), s.data<Buoy>("buoy"), tide, now.getTime());
    },
  },
  {
    id: "moments", everyMs: 60e3, staleAfterMs: 15 * 60e3,
    run: async ({ store: s, now }) => {
      const list = moments({
        weather: s.data<Weather>("weather"), beach: s.data<Beach>("beach"), sunrise: s.data<Sunrise>("sunrise"), iss: s.data<Iss>("iss"),
        space: s.data<SpaceWeather>("space"), fires: s.data<Fires>("fires"), flights: s.data<Flights>("flights"),
      }, now);
      await push?.dispatch(due(list, now), now);
      return list;
    },
  },
  {
    // Track record en production : relu dans l'archive toutes les 3 heures (30 jours glissants).
    id: "verify", everyMs: 3 * 3600e3, staleAfterMs: 12 * 3600e3,
    run: async ({ now }) => {
      if (!loadArchive) throw new Error("no archive");
      const t0 = Date.now();
      const v = verify(await loadArchive(now), now.getTime() / 1000);
      console.log(JSON.stringify({ event: "verified", ms: Date.now() - t0, temp: v.correction.temp.why, wind: v.correction.wind.why, n: v.scores.map((x) => `${x.key}:${x.n}`).join(",") }));
      return v;
    },
  },
  {
    id: "brief", everyMs: 30 * 60e3, staleAfterMs: 2 * 3600e3,
    run: async ({ store: s, now }) => {
      if (!s.data("weather")) throw new Error("waiting for weather");
      return writeBrief(llm, facts(s.data<Weather>("weather"), s.data<Beach>("beach"), tideNext(now), s.data<Moment[]>("moments") ?? [], now), now);
    },
  },
];

const collectors: Collector[] = [
  weather, metar, marine, buoy, airportForecast, buoyForecast, flightsCollector((o) => void archiveOutcome(archive, o)),
  satelliteCollector({ onImage: (png) => { satellitePng = png; }, onSunrise: (s) => void archiveSunriseSky(archive, s) }), fires, air, space, issCollector(), sunrise, newsCollector(llm), ...derived,
];
startCollectors(store, collectors, { offline: cfg.offline });

// Mode démonstration : uniquement hors ligne, pour les tests de bout en bout et les captures.
const demoPath = process.env.DEMO_SNAPSHOT;
if (cfg.offline && demoPath) {
  const { existsSync, readFileSync } = await import("node:fs");
  const demo = JSON.parse(readFileSync(demoPath, "utf8")) as Record<string, unknown>;
  store.demo = true;
  for (const [id, d] of Object.entries(demo)) store.success(id, d);
  if (existsSync(`${demoPath}.png`)) satellitePng = readFileSync(`${demoPath}.png`);
}

// Archive horaire, première écriture 5 minutes après le démarrage.
if (archive && !cfg.offline) {
  const tick = () => archiveHour(archive, store).then((n) => console.log(JSON.stringify({ event: "archived", rows: n })));
  setTimeout(() => { tick(); setInterval(tick, 3600e3); }, 5 * 60e3);
}

const app = createApp(cfg, store, { push: push ?? undefined, vote: (v) => archiveVote(archive, v), satellite: () => satellitePng });
serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(JSON.stringify({ event: "listening", port: info.port, version: cfg.version, llm: !!llm, push: !!push, archive: !!archive }));
});
