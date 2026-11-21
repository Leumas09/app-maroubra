import type { Iss, SourceEntry, SpaceWeather, Sunrise, WeatherHour } from "@maroubra/core";
import { useEffect, useMemo, useState } from "react";
import { SkyChart, type Catalog } from "../components/SkyChart";
import { nightWindow, skyEvents, type SkyEvent } from "../lib/sky-events";
import { Fresh } from "../components/bits";
import { HorizonChart } from "../components/HorizonChart";
import { auroraText } from "./FireAir";
import { compass, duration, pct, shortDate, time } from "../lib/format";
import type { SkyModel } from "../lib/sky-model";

/** Nuages prévus pendant une fenêtre (moyenne horaire), en %. */
export function cloudDuring(hours: WeatherHour[] | null | undefined, start: Date, end: Date): number | null {
  const hs = (hours ?? []).filter((h) => h.t * 1000 >= start.getTime() - 1800e3 && h.t * 1000 <= end.getTime());
  return hs.length ? hs.reduce((a, h) => a + h.cloud, 0) / hs.length : null;
}

export function skyLede(s: SkyModel, hours?: WeatherHour[] | null): string {
  const parts: string[] = [];
  if (!s.isNight && s.sun.set) parts.push(`Sunset ${time(s.sun.set)}`);
  const dark = s.dark[0];
  const cloud = dark ? cloudDuring(hours, dark.start, dark.end) : null;
  if (dark) parts.push(`dark sky from ${time(dark.start)} for ${duration(dark.end.getTime() - dark.start.getTime())}${cloud != null && cloud >= 70 ? `, but mostly cloudy (${Math.round(cloud)}%)` : cloud != null && cloud <= 20 ? ", and clear" : ""}`);
  else parts.push("no truly dark sky tonight, the Moon is up");
  const m = s.moonriseOverSeaNext[0];
  if (m && m.time.getTime() - s.now.getTime() < 24 * 3600e3) parts.push(`the Moon rises over the sea at ${time(m.time)}`);
  if (s.planets.length) parts.push(`${s.planets.map((p) => p.name).join(" and ")} ${s.planets.length > 1 ? "are" : "is"} up`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

type E<T> = (SourceEntry<T> & { stale: boolean; ageMin: number | null }) | null;

const EVENT_ICON: Record<SkyEvent["kind"], string> = { iss: "ISS", planet: "Planet", milkyway: "Milky Way", meteors: "Meteors", moon: "Moon", conjunction: "Pair", eclipse: "Eclipse" };

/** Catalogue d'étoiles chargé seulement sur cette page (180 Ko). */
function useCatalog(): Catalog | null {
  const [c, setC] = useState<Catalog | null>(null);
  useEffect(() => { void import("../data/sky-catalog.json").then((m) => setC(m.default as unknown as Catalog)); }, []);
  return c;
}

function TonightBest({ events }: { events: SkyEvent[] }) {
  const best = events.filter((e) => e.score != null).reduce<SkyEvent | null>((m, e) => (!m || e.score! > m.score! ? e : m), null);
  return (
    <div className="card">
      <h2>Tonight, the best to see</h2>
      {events.length ? (
        <ol className="sky-events">
          {events.map((e) => (
            <li key={e.key} className={e === best && (e.score ?? 0) >= 5 ? "top" : undefined}>
              <span className="sky-ev-when">{time(e.at)}{e.until ? <small>to {time(e.until)}</small> : null}</span>
              <span className="sky-ev-what">
                <span className="sky-ev-kind">{EVENT_ICON[e.kind]}</span>
                <strong>{e.title}</strong>
                <span className="sky-ev-detail">{e.detail}. Look {compass(e.az)}{e.alt > 2 ? `, ${Math.round(e.alt)}° up` : ", on the horizon"}.</span>
              </span>
              <span className={`sky-ev-score${e.score == null ? " unknown" : e.score >= 7 ? " good" : e.score >= 4 ? " maybe" : " poor"}`} title={e.why}>
                {e.score == null ? "?" : e.score.toFixed(1)}
                <small>{e.score == null ? "clouds unknown" : e.score >= 7 ? "good chance" : e.score >= 4 ? "maybe" : "unlikely"}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : <p className="muted" style={{ margin: 0 }}>Nothing special tonight beyond the stars themselves.</p>}
      <p className="note">Visibility score from the cloud forecast by layer, the Moon (for faint things) and height in the sky. Experimental: being checked against real cloud cover. Meteor dates from the IMO working list.</p>
    </div>
  );
}

export function Sky({ s, iss, space, sunrise, hours }: { s: SkyModel; iss?: E<Iss>; space?: E<SpaceWeather>; sunrise?: E<Sunrise>; hours?: WeatherHour[] | null }) {
  const catalog = useCatalog();
  const events = useMemo(() => skyEvents(s.now, s, iss?.data ?? null, hours ?? null), [s.now.getTime(), iss?.data, hours]);
  // Heure de la carte : maintenant la nuit ; le jour, la nuit noire qui vient. Curseur sur 12 h par quarts d'heure.
  const night0 = useMemo(() => nightWindow(s.now).start, [Math.floor(s.now.getTime() / 600e3)]);
  const base = s.isNight ? s.now : night0;
  const [offset, setOffset] = useState(0);
  const chartAt = new Date(base.getTime() + offset * 15 * 60e3);
  const passes = iss?.data?.passes.filter((p) => Date.parse(p.end) > s.now.getTime()).slice(0, 4) ?? [];
  const sr = sunrise?.data;
  return (
    <section aria-labelledby="sky-title" className="layout-main" style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h1 id="sky-title" style={{ margin: "0 0 8px", fontSize: 15, color: "var(--muted)" }}>{s.isNight ? "Tonight over Maroubra" : "The sky over Maroubra"}</h1>
        <p className="lede">{skyLede(s, hours)}</p>
      </div>
      <TonightBest events={events} />
      <div className="card sky-chart-card">
        <div className="card-head">
          <h2>The sky at {time(chartAt)}{chartAt.getTime() - s.now.getTime() > 3600e3 ? ` ${shortDate(chartAt).split(",")[0]}` : ""}</h2>
          <label className="sky-time">
            <span className="sr-only">Time of the sky chart</span>
            <input type="range" min={0} max={48} step={1} value={offset} onChange={(e) => setOffset(Number(e.target.value))} />
            <button className="btn ghost small" onClick={() => setOffset(0)} disabled={offset === 0}>{s.isNight ? "Now" : "Tonight"}</button>
          </label>
        </div>
        {catalog ? <SkyChart catalog={catalog} at={chartAt} night={s.isNight} /> : <div className="skychart-wait" aria-busy="true">Loading the star catalogue…</div>}
        <p className="note">Stars to magnitude 5 from the Hipparcos catalogue (d3-celestial data), positions checked against Skyfield to under 1 arcminute.</p>
      </div>
      <div className="card chart-card" style={{ padding: 12 }}>
        <HorizonChart sun={s.tracks.sun} moon={s.tracks.moon} planets={s.tracks.planets} summary={skyLede(s, hours)} />
      </div>
      <div className="grid">
        <div className="card">
          <h2>Sun</h2>
          <dl className="kv">
            <dt>Sunrise</dt><dd>{time(s.sun.rise)}</dd>
            <dt>Golden hour</dt><dd>{time(s.sun.goldenEvening)}</dd>
            <dt>Sunset</dt><dd>{time(s.sun.set)}</dd>
            <dt>Last light</dt><dd>{time(s.sun.civilDusk)}</dd>
            <dt>Fully dark</dt><dd>{time(s.sun.astroDusk)}</dd>
            <dt>Next sunrise</dt><dd>{time(s.sun.nextRise)}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Moon</h2>
          <div className="big">{pct(s.moon.illumination)}</div>
          <p className="sub" style={{ margin: "4px 0 12px" }}>{s.moon.phase}</p>
          <dl className="kv">
            <dt>Moonrise</dt><dd>{time(s.moon.rise)}{s.moon.riseAz != null ? ` ${compass(s.moon.riseAz)}` : ""}</dd>
            <dt>Moonset</dt><dd>{time(s.moon.set)}</dd>
            <dt>Full moon</dt><dd>{shortDate(s.moon.nextFull)}</dd>
            <dt>New moon</dt><dd>{shortDate(s.moon.nextNew)}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Dark sky</h2>
          {s.dark.length ? (
            <ul className="list">
              {s.dark.map((w) => (
                <li key={w.start.toISOString()}><span className="when">{time(w.start)}</span><span>until {time(w.end)}, {duration(w.end.getTime() - w.start.getTime())} with no Sun and no Moon</span></li>
              ))}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>The Moon lights the sky all night. Best for the Moon itself, not for faint stars.</p>}
        </div>
        <div className="card">
          <h2>Planets at {time(s.planetsAt)}</h2>
          {s.planets.length ? (
            <ul className="list">
              {s.planets.map((p) => (
                <li key={p.name}><span className="when">{p.name}</span><span>{p.alt.toFixed(0)}° high, {compass(p.az)}, magnitude {p.magnitude.toFixed(1)}</span></li>
              ))}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>No bright planet above 10° at that time.</p>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Sunrise {sr ? shortDate(new Date(sr.time)) : ""}</h2><Fresh e={sunrise ?? null} label="Forecast" /></div>
          {sr ? (
            <>
              <div className="big">{sr.score.toFixed(1)}<span className="muted" style={{ fontSize: 16 }}> / 10</span></div>
              <p className="sub" style={{ margin: "4px 0 8px" }}>{sr.label}, {time(new Date(sr.time))}</p>
              <p style={{ margin: 0 }}>{sr.why}.</p>
              <p className="note">Experimental score from the cloud forecast along the sun's path over the sea. Being checked against real sunrises.</p>
            </>
          ) : <p className="muted" style={{ margin: 0 }}>No sunrise forecast yet.</p>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Space Station</h2><Fresh e={iss ?? null} label="Orbit" /></div>
          {passes.length ? (
            <ul className="list">
              {passes.map((p) => (
                <li key={p.start}><span className="when">{time(new Date(p.start))}</span><span>{shortDate(new Date(p.start))}, {compass(p.startAz)} to {compass(p.endAz)}, up to {p.maxAlt}° high, {p.durationMin} min</span></li>
              ))}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>No visible pass in the next three days.</p>}
          <p className="note">A bright, steady, moving star. Visible only when it is lit by the sun and our sky is dark.</p>
        </div>
        <div className="card">
          <div className="card-head"><h2>Aurora australis</h2><Fresh e={space ?? null} /></div>
          <p style={{ margin: 0, lineHeight: 1.5 }}>{auroraText(space?.data ?? null)}</p>
        </div>
        <div className="card">
          <h2>Moonrise over the sea, next 30 days</h2>
          {s.moonriseOverSeaNext.length ? (
            <ul className="list">
              {s.moonriseOverSeaNext.map((m) => (
                <li key={m.time.toISOString()}><span className="when">{shortDate(m.time)}</span><span>{time(m.time)}, {compass(m.azimuth)}, {pct(m.illumination)} lit</span></li>
              ))}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>None with a bright Moon in the next 30 days.</p>}
          <p className="note">Sea horizon assumed between {40}° and {160}° from north, to be measured on site.</p>
        </div>
      </div>
    </section>
  );
}
