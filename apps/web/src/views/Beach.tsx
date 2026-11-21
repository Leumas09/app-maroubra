// La plage : d'abord le statut officiel (sauveteurs, Beachwatch, Beachsafe), puis notre score expliqué,
// le ruban horaire qui montre pourquoi le meilleur créneau est le meilleur, les instruments et les webcams.
import type { Beach as B, BeachStatus, Buoy, Marine, SourceEntry, SwimHour } from "@maroubra/core";
import { BeachCompass, DayRibbon, FactorBars, Scale, UV_ZONES, WATER_ZONES, scoreColor } from "../components/beach-viz";
import { Flag, officialStatus } from "../components/beach-status";
import { CardHead, Empty, Fresh } from "../components/bits";
import { compass, time } from "../lib/format";
import type { TideTable } from "../lib/tide";
import { SeaSection } from "./Tide";

type E<T> = (SourceEntry<T> & { stale: boolean; ageMin: number | null }) | null;

const CAMS_PAGE = "https://www.randwick.nsw.gov.au/facilities-and-recreation/explore-randwick-city/beach-cams";
const REPORT_PAGE = "https://www.randwick.nsw.gov.au/facilities-and-recreation/beaches-and-coast/lifeguard-reports";
const sydneyHour = (d: Date) => Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(d));
const sydneyDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(d);

function OfficialStatus({ e, now }: { e: E<BeachStatus>; now: Date }) {
  const s = e?.data;
  const lg = s?.lifeguard;
  const { status, headline, patrol } = officialStatus(e, now);
  const sub = [
    patrol,
    lg ? `Lifeguard report ${lg.today ? "" : `of ${new Date(lg.at).toLocaleDateString("en-AU", { weekday: "long", timeZone: "Australia/Sydney" })} `}at ${time(new Date(lg.at))}` : null,
  ].filter(Boolean).join(". ");
  const chip = (label: string, value: string, bad: boolean, good = false) => (
    <span className={`chip${bad ? " bad" : good ? " ok" : ""}`}><span className="chip-k">{label}</span> {value}</span>
  );
  const ripsBad = /danger|strong|caution|cautious/i.test(lg?.rips ?? "");
  const bbBad = lg?.bluebottles != null && !/none/i.test(lg.bluebottles);
  const wq = s?.water?.forecast;
  return (
    <div className={`status-band ${status}`} role="status">
      <Flag kind={status === "closed" ? "closed" : status === "open" ? "patrol" : "unknown"} />
      <div className="status-main">
        <div className="status-kicker">Official status <Fresh e={e} label="Checked" /></div>
        <p className="status-word">{headline}</p>
        {sub && <p className="status-sub">{sub}.</p>}
        {lg && (lg.description || lg.summary) && (
          <p className="status-quote">“{[lg.summary, lg.description].filter((x, i, a) => x && a.indexOf(x) === i).join(". ").replace(/\.\./g, ".")}”</p>
        )}
        <div className="chips">
          {lg?.rips && chip("Rips", lg.rips, ripsBad, /minimal|low/i.test(lg.rips))}
          {lg?.bluebottles && chip("Bluebottles", lg.bluebottles, bbBad, !bbBad)}
          {lg?.waveHeight && chip("Waves", lg.waveHeight, false)}
          {wq && chip("Water quality", `pollution ${wq.toLowerCase()}`, wq !== "Unlikely", wq === "Unlikely")}
          {s?.hazard != null && chip("Beach hazard", `${s.hazard}/10`, s.hazard >= 7)}
        </div>
        <p className="note">
          Lifeguards of <a href={REPORT_PAGE} target="_blank" rel="noreferrer">Randwick City Council</a> post each morning; closures during the day may not show here.
          Water quality: <a href="https://www.beachwatch.nsw.gov.au/" target="_blank" rel="noreferrer">NSW Beachwatch</a>. Patrols and hazard rating: <a href="https://beachsafe.org.au/beach/nsw/randwick/maroubra-south/maroubra" target="_blank" rel="noreferrer">Beachsafe</a>.
        </p>
      </div>
    </div>
  );
}

const SIDE_TEXT: Record<SwimHour["side"], string> = {
  offshore: "Blowing from the land: it holds the waves up and keeps the water clean.",
  "cross-shore": "Blowing along the beach: some chop, and a drift along the shore.",
  onshore: "Blowing from the sea: choppy, messy water, and bluebottles when it's easterly.",
};

function Instruments({ b, now, lifeguardTemp }: { b: B; now: Date; lifeguardTemp: string | null }) {
  const sea = b.sea;
  const sideColor = sea.side === "offshore" ? "var(--good)" : sea.side === "onshore" ? "var(--alert)" : "var(--muted)";
  const today = b.hours.filter((h) => sydneyDay(new Date(h.t * 1000)) === sydneyDay(now));
  const nowH = b.hours.find((h) => h.t + 3600 > now.getTime() / 1000) ?? b.hours[0];
  const peak = today.reduce<SwimHour | null>((m, h) => (!m || h.uv > m.uv ? h : m), null);
  const sun = today.filter((h) => h.uv >= 3);
  const period = sea.periodS;
  return (
    <div className="instruments">
      <div className="instrument">
        <h2>Wind</h2>
        <BeachCompass fromDeg={sea.windDir} facing={b.facing} kind="wind" color={sideColor} />
        <p className="inst-value"><span style={{ color: sideColor }}>{sea.side.charAt(0).toUpperCase() + sea.side.slice(1)}</span> {compass(sea.windDir)} {sea.windKmh} km/h</p>
        <p className="inst-sub">Gusts {sea.gustKmh} km/h. {SIDE_TEXT[sea.side]}</p>
      </div>
      <div className="instrument">
        <h2>Swell</h2>
        {sea.dir != null ? <BeachCompass fromDeg={sea.dir} facing={b.facing} kind="swell" color="var(--accent)" /> : <Empty>No swell direction.</Empty>}
        <p className="inst-value">{sea.surfM != null ? `${sea.surfM} m` : "n/a"} <span className="muted">at the beach{sea.dir != null ? `, from the ${compass(sea.dir)}` : ""}</span></p>
        {period != null && <Scale value={period} min={4} max={18} unit=" s" label="Swell period" zones={[{ to: 8, name: "Short, choppy", color: "oklch(72% 0.06 220)" }, { to: 12, name: "Regular", color: "oklch(66% 0.09 205)" }, { to: 18, name: "Long, powerful", color: "oklch(55% 0.12 250)" }]} />}
        <p className="inst-sub">{period != null ? `${Math.round(period)} s between waves. ` : ""}{sea.label} sea.</p>
      </div>
      <div className="instrument">
        <h2>Water</h2>
        <p className="inst-big">{b.waterTemp != null ? `${b.waterTemp.toFixed(1)}°` : "n/a"}</p>
        {b.waterTemp != null && <Scale value={b.waterTemp} min={14} max={26} unit="°C" label="Water temperature" zones={WATER_ZONES} />}
        <p className="inst-sub">Sea surface model offshore{lifeguardTemp ? `; the lifeguards measured ${lifeguardTemp.replace(/\s*C$/i, "°C")} this morning` : ""}.{b.waterTemp != null && b.waterTemp < 19 ? " A wetsuit helps for a long swim." : ""}</p>
      </div>
      <div className="instrument">
        <h2>Sun</h2>
        <p className="inst-big">UV {nowH ? Math.round(nowH.uv) : "n/a"}</p>
        {nowH && <Scale value={nowH.uv} min={0} max={13} unit="" label="UV index now" zones={UV_ZONES} />}
        <p className="inst-sub">
          {peak ? `Peak ${Math.round(peak.uv)} at ${time(new Date(peak.t * 1000))}. ` : ""}
          {sun.length ? `Sun protection ${sun[0].t * 1000 <= now.getTime() ? "until" : `from ${time(new Date(sun[0].t * 1000))} to`} ${time(new Date(sun.at(-1)!.t * 1000 + 3600e3))}.` : "Low UV for the rest of the day."}
        </p>
      </div>
    </div>
  );
}

/** Webcams de la mairie : lien vers le direct, avec la photo du matin des sauveteurs quand elle existe. */
function Cams({ photo, photoAt }: { photo: string | null; photoAt: string | null }) {
  const cams = [
    { id: "north", name: "Maroubra", where: "North end of the beach", photo },
    { id: "south", name: "Maroubra South", where: "South end of the beach", photo: null },
  ];
  return (
    <div className="card">
      <CardHead title="Live cams"><span className="fresh">Randwick City Council</span></CardHead>
      <div className="cams">
        {cams.map((c) => (
          <a key={c.id} className="cam" href={CAMS_PAGE} target="_blank" rel="noreferrer">
            <div className="cam-view">
              {c.photo ? <img src={c.photo} alt={`${c.name}, lifeguard photo`} loading="lazy" referrerPolicy="no-referrer" /> : (
                <svg viewBox="0 0 320 180" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
                  <rect width="320" height="180" fill="var(--sky-bottom)" />
                  <rect y="70" width="320" height="60" fill="var(--sea)" />
                  {[84, 98, 112].map((y, i) => <path key={y} d={`M0 ${y} q40 -6 80 0 t80 0 t80 0 t80 0`} fill="none" stroke="var(--paper)" strokeOpacity={0.7 - i * 0.15} strokeWidth="2" />)}
                  <path d="M0 130 Q160 112 320 124 V180 H0 Z" fill="var(--sand)" />
                  <path d="M250 70 q30 -14 70 -10 v10 z" fill="var(--ink-2)" opacity="0.35" />
                </svg>
              )}
              <span className="cam-live"><span className="dot" />Watch live</span>
            </div>
            <div className="cam-name">{c.name}</div>
            <div className="cam-where">{c.photo && photoAt ? `Photo from the lifeguard report at ${time(new Date(photoAt))}` : c.where}</div>
          </a>
        ))}
      </div>
      <p className="note">The council cams can go offline in rough weather. Swellnet also runs a free Maroubra cam: <a href="https://www.swellnet.com/surfcams/maroubra" target="_blank" rel="noreferrer">swellnet.com</a>.</p>
    </div>
  );
}

function verdict(b: B, daylight: boolean, closed: boolean): string {
  if (closed) return "Closed today. Stay out of the water.";
  if (!daylight) return "Beach time is over for today.";
  return { Great: "Great for a swim right now.", Good: "Good for a swim right now.", Fair: "Fair: swimmable, with care.", Poor: "Poor conditions for a swim.", "Stay out": "Stay out of the water." }[b.label];
}

interface Props { e: E<B>; status: E<BeachStatus>; tide: TideTable | null; now: Date; buoy: E<Buoy>; marine: E<Marine> }

export function Beach({ e, status, tide, now, buoy, marine }: Props) {
  const b = e?.data;
  const official = <OfficialStatus e={status} now={now} />;
  const sea = <SeaSection table={tide} now={now} buoy={buoy} marine={marine} />;
  if (!b) return <section className="beach">{official}<div className="card"><CardHead title="Beach"><Fresh e={e} /></CardHead><Empty>Waiting for weather and sea data.</Empty></div>{sea}</section>;
  const hour = sydneyHour(now);
  const daylight = hour >= 7 && hour < 19;
  const closed = status?.data?.status === "closed";
  const best = b.best;
  const bestToday = best && sydneyDay(new Date(best.start * 1000)) === sydneyDay(now);
  const lg = status?.data?.lifeguard;
  return (
    <section aria-labelledby="beach-title" className="beach">
      <h1 id="beach-title" className="sr-only">Maroubra Beach</h1>
      {official}
      <div className="beach-hero">
        <div className="hero-top">
          <p className="lede">{verdict(b, daylight, closed)}</p>
          <span className="swim-pill" title="Swim score now, computed from wind, swell, tide, UV, water and patrols; checked in the Track record">
            <i style={{ background: daylight ? scoreColor(b.score) : "var(--muted)" }} aria-hidden="true" />
            <span className="swim-pill-k">Swim score</span>
            {daylight ? <strong>{b.score.toFixed(1)}</strong> : <strong>night</strong>}
            {daylight && <span className="swim-pill-label">{b.label}</span>}
          </span>
        </div>
        {best && (
          <div className="best">
            <p className="best-when">
              <span className="best-k">{bestToday ? "Best today" : "Best tomorrow"}</span>
              {time(new Date(best.start * 1000))} to {time(new Date(best.end * 1000))}
              <span className="best-score" style={{ background: scoreColor(best.score) }}>{best.score.toFixed(1)}</span>
            </p>
            <ul className="because">
              {best.because.map((t) => <li key={t} className="plus">{t}</li>)}
              {best.still.map((t) => <li key={t} className="minus">{t}</li>)}
            </ul>
          </div>
        )}
        <p className="note">Swim score <Fresh e={e} label="computed" /></p>
      </div>
      <div className="card chart-scroll" style={{ padding: "14px 14px 8px" }}>
        <DayRibbon b={b} now={now} tide={tide} />
        <div className="legend" aria-hidden="true">
          <span><i style={{ background: "var(--good)" }} />offshore wind</span>
          <span><i style={{ background: "var(--muted)" }} />cross-shore</span>
          <span><i style={{ background: "var(--alert)" }} />onshore</span>
          <span>arrows point where the wind blows</span>
        </div>
      </div>
      <Instruments b={b} now={now} lifeguardTemp={lg?.today ? lg.waterTemp : null} />
      <div className="grid">
        <div className="card">
          <h2>{daylight ? "What makes the score now" : "Conditions now"}</h2>
          <FactorBars reasons={b.reasons} score={b.score} />
          <p className="note">The score starts at 10; each factor takes points off, as a lifeguard would weigh it. Every forecast is checked in the Track record.</p>
        </div>
        <Cams photo={lg?.today ? lg.photo : null} photoAt={lg?.at ?? null} />
      </div>
      {sea}
    </section>
  );
}
