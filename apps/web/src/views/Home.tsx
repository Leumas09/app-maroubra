// Accueil (direction B « Instrument ») : l'heure, une phrase, le ciel tracé, les niveaux et les prochains moments.
import { useState } from "react";
import type { Beach, Buoy, Marine, SourceEntry, SpaceWeather, Sunrise, Weather } from "@maroubra/core";
import { CenteredScroll } from "../components/CenteredScroll";
import { focusOf, HorizonChart } from "../components/HorizonChart";
import { compass, longDate, pct, time } from "../lib/format";
import type { SkyModel } from "../lib/sky-model";
import { skyLede } from "./Sky";

type E<T> = (SourceEntry<T> & { stale: boolean; ageMin: number | null }) | null;

export interface HomeMoment { at: Date; title: string; detail: string; urgent: boolean }

interface Level {
  label: string;
  value: string;
  sub: string;
  /** Niveau entre 0 et 1, null si la donnée manque. */
  level: number | null;
  /** Repère sur l'échelle (seuil), entre 0 et 1. */
  mark?: number;
  lit?: boolean;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

function Gauge({ g }: { g: Level }) {
  return (
    <div className="gauge">
      <div className="gauge-value">{g.value}</div>
      <div className="gauge-slot" aria-hidden="true">
        {g.level != null && <span className={`gauge-fill${g.lit ? " lit" : ""}`} style={{ height: `${Math.round(clamp(g.level) * 100)}%` }} />}
        {g.mark != null && <span className="gauge-mark" style={{ bottom: `${Math.round(g.mark * 100)}%` }} />}
      </div>
      <div className="gauge-label">{g.label}</div>
      <div className="gauge-sub">{g.sub}</div>
    </div>
  );
}

const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(d);
const localHour = (d: Date) => Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(d));
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};
function voterId(): string {
  let id = store.get("mb.voter");
  if (!id) { id = crypto.randomUUID?.() ?? String(Math.random()).slice(2); store.set("mb.voter", id); }
  return id;
}

/**
 * Le juge du score de lever de soleil : chaque matin, la famille dit si le lever valait le coup.
 * Visible une fois le Soleil levé et jusqu'à 11 h, une fois par appareil.
 */
function SunriseVote({ now, sunAlt }: { now: Date; sunAlt: number }) {
  // L'écran ambiant reste ouvert des jours : tout est rapporté au jour courant, pas au montage.
  const day = localDay(now);
  const [voted, setVoted] = useState(() => store.get("mb.voted"));
  const [msg, setMsg] = useState<{ day: string; text: string; retry?: boolean } | null>(null);
  const shown = msg?.day === day ? msg : null;
  if (sunAlt < 3 || localHour(now) >= 11 || (voted === day && !shown)) return null;
  const done = (text: string) => { store.set("mb.voted", day); setVoted(day); setMsg({ day, text }); };
  const vote = async (value: number | null) => {
    if (value == null) { done("No problem. Ask again tomorrow."); return; }
    const r = await fetch("/api/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: day, value, voter: voterId() }) }).catch(() => null);
    if (r?.ok) done("Thanks. Your vote checks the sunrise score in the Track record.");
    else setMsg({ day, text: "Could not save the vote. Try again?", retry: true });
  };
  return (
    <div className="vote" role="group" aria-labelledby="vote-q">
      <span id="vote-q">{shown?.text ?? "This morning's sunrise: worth getting up for?"}</span>
      {(!shown || shown.retry) && (
        <span className="vote-buttons">
          <button className="btn" onClick={() => vote(2)}>Yes</button>
          <button className="btn ghost" onClick={() => vote(1)}>So-so</button>
          <button className="btn ghost" onClick={() => vote(0)}>No</button>
          <button className="btn ghost" onClick={() => vote(null)}>Didn't see it</button>
        </span>
      )}
    </div>
  );
}

interface Props {
  now: Date;
  sky: SkyModel | null;
  brief: string | null;
  beach: E<Beach>;
  weather: E<Weather>;
  buoy: E<Buoy>;
  marine: E<Marine>;
  sunrise: E<Sunrise>;
  space: E<SpaceWeather>;
  moments: HomeMoment[];
}

export function Home({ now, sky, brief, beach, weather, buoy, marine, sunrise, space, moments }: Props) {
  const night = !!sky?.isNight;
  const b = beach?.data;
  const w = weather?.data;
  const hs = buoy?.data?.latest?.hs ?? null;
  const tp = buoy?.data?.latest?.tp ?? null;
  const dir = buoy?.data?.latest?.dir ?? null;
  const water = b?.waterTemp ?? marine?.data?.hourly[0]?.sst ?? null;
  const sr = sunrise?.data;
  const sp = space?.data;

  const beachLevel: Level = {
    label: "Beach",
    value: b ? (night && b.best ? b.best.score.toFixed(1) : b.score.toFixed(1)) : "n/a",
    sub: b?.best ? (night ? `best ${time(new Date(b.best.start * 1000))}` : `${b.best.score} at ${time(new Date(b.best.start * 1000))}`) : b?.label ?? "",
    level: b ? (night && b.best ? b.best.score : b.score) / 10 : null,
    lit: !night,
    mark: !night && b?.best ? b.best.score / 10 : undefined,
  };
  const swell: Level = {
    label: "Swell",
    value: hs != null ? `${hs.toFixed(1)} m` : "n/a",
    sub: [tp != null ? `${Math.round(tp)} s` : null, dir != null ? compass(dir) : null].filter(Boolean).join(", "),
    level: hs != null ? hs / 4 : null,
  };

  const levels: Level[] = night
    ? [
        { label: "Sunrise", value: sr ? sr.score.toFixed(1) : "n/a", sub: sr ? time(new Date(sr.time)) : "", level: sr ? sr.score / 10 : null, lit: true },
        beachLevel,
        swell,
        { label: "Moon", value: sky ? pct(sky.moon.illumination) : "n/a", sub: sky?.moon.phase.split(" ")[0]?.toLowerCase() ?? "", level: sky ? sky.moon.illumination : null },
        { label: "Kp", value: sp?.kpNow != null ? sp.kpNow.toFixed(1) : "n/a", sub: "aurora at 6", level: sp?.kpNow != null ? sp.kpNow / 9 : null, mark: 6 / 9 },
      ]
    : [
        beachLevel,
        { label: "UV", value: w ? `${Math.round(w.current.uv)}` : "n/a", sub: w ? uvText(w.current.uv) : "", level: w ? w.current.uv / 12 : null },
        { label: "Wind", value: w ? `${Math.round(w.current.wind)}` : "n/a", sub: w ? `km/h, ${compass(w.current.windDir)}` : "", level: w ? w.current.wind / 50 : null },
        swell,
        { label: "Water", value: water != null ? `${water.toFixed(1)}°` : "n/a", sub: "sea surface", level: water != null ? (water - 12) / 14 : null },
      ];

  const headline = night && sky ? skyLede(sky, w) : brief ?? (sky ? skyLede(sky, w) : "Reading the sky and the sea…");
  const sub = night ? brief : null;

  return (
    <section aria-labelledby="home-title" className="home">
      <div className="home-head">
        <div>
          <div className="clock">{time(now)}</div>
          <div className="clock-date">{longDate(now)}</div>
        </div>
        <div className="home-say">
          <h1 id="home-title" className={[headline.length > 80 ? "long" : "", brief || sky ? "" : "muted"].filter(Boolean).join(" ") || undefined}>{headline}</h1>
          {sub && <p>{sub}</p>}
        </div>
      </div>

      {sky && <SunriseVote now={now} sunAlt={sky.sunAltNow} />}

      {sky ? (
        <CenteredScroll className="band chart-scroll" focus={focusOf(sky.tracks.sun, sky.tracks.moon)}>
          <HorizonChart sun={sky.tracks.sun} moon={sky.tracks.moon} planets={sky.tracks.planets} summary={skyLede(sky, w)} />
        </CenteredScroll>
      ) : <div className="band" style={{ minHeight: 213 }} aria-busy="true" />}

      <div className="home-foot">
        <div className="panel levels" role="group" aria-label="Levels right now">
          {levels.map((g) => <Gauge key={g.label} g={g} />)}
        </div>
        <section aria-labelledby="next-title" className="next">
          <h2 id="next-title">Next</h2>
          <ol>
            {moments.slice(0, 5).map((m) => (
              <li key={m.title + m.at.toISOString()} className={m.urgent ? "urgent" : undefined}>
                <span className="when">{time(m.at)}</span>
                <span><span className="what">{m.title}</span>{m.detail && <span className="detail">{m.detail}</span>}</span>
              </li>
            ))}
          </ol>
          {!moments.length && <p className="muted">Nothing timed in the next 24 hours.</p>}
        </section>
      </div>
    </section>
  );
}

function uvText(uv: number): string {
  return uv < 3 ? "low" : uv < 6 ? "moderate" : uv < 8 ? "high" : uv < 11 ? "very high" : "extreme";
}
