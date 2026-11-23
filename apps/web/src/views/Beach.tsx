// La plage : d'abord le statut officiel (sauveteurs, Beachwatch, Beachsafe), puis notre score expliqué,
// le ruban horaire qui montre pourquoi le meilleur créneau est le meilleur, les instruments et les webcams.
import type { Beach as B, BeachStatus, Buoy, Marine, SourceEntry, SurfCrowd, SurfWatch, SwimHour } from "@maroubra/core";
import { BeachCompass, DayRibbon, FactorBars, Scale, UV_ZONES, WATER_ZONES, scoreColor } from "../components/beach-viz";
import { Flag, officialStatus } from "../components/beach-status";
import { CardHead, Empty, Fresh } from "../components/bits";
import { compass, time } from "../lib/format";
import type { TideTable } from "../lib/tide";
import { useEffect, useRef, useState } from "react";
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

/** Caméras de la mairie de Randwick (service vidéo secdn.net, adresses relevées sur leur page des webcams). */
const camImage = (id: string, t: number) => `https://randwickcc-thumb.secdn.net/randwickcc-channel/play/${id}/thumbnail.jpg?t=${t}`;
const CAM_REFRESH_MS = 30_000;
/** Au-delà, une image qui ne se renouvelle plus n'est plus présentée comme « en direct ». */
const CAM_STALE_MS = 3 * 60_000;

/**
 * Image en direct d'une caméra : chargée à part puis affichée, pour garder la dernière bonne image si un
 * chargement échoue. Renouvelée toutes les 30 s et dès que la page redevient visible (les minuteries d'un
 * onglet ou d'une app en arrière-plan sont suspendues : sans cela, on rouvre l'app sur l'image de la veille).
 */
function useCamImage(id: string, active: boolean): { url: string | null; down: boolean } {
  const [shown, setShown] = useState<{ url: string; at: number } | null>(null);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = () => {
      const url = camImage(id, Math.floor(Date.now() / 1000));
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => { if (alive) { setShown({ url, at: Date.now() }); setFailedAt(null); } };
      img.onerror = () => { if (alive) setFailedAt(Date.now()); };
      img.src = url;
    };
    load();
    const timer = setInterval(load, CAM_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [id, active]);
  const down = failedAt != null && (!shown || failedAt - shown.at > CAM_STALE_MS);
  return { url: down ? null : shown?.url ?? null, down };
}

/**
 * Une caméra : l'image en direct de la mairie (une nouvelle image par minute environ), qu'on touche pour
 * la voir en grand. La vidéo n'est pas lue dans la page : le serveur de la mairie refuse le flux hors de
 * son propre site (403, voir docs/PLAN.md, partie T) ; un lien y mène.
 */
function CamView({ id, name, where, offline }: { id: string; name: string; where: string; offline: boolean }) {
  const { url, down } = useCamImage(id, !offline);
  const [zoom, setZoom] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(false); };
    document.addEventListener("keydown", onKey);
    // Téléphone tenu droit : l'image garde toute la hauteur de l'écran et se fait glisser ; on part du milieu.
    const el = scroller.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom]);
  const alt = `${name}, live image from the council camera`;
  return (
    <div className="cam">
      <div className="cam-view">
        {offline ? <div className="cam-off">Live image (not loaded with sample data)</div>
          : down ? <div className="cam-off">Camera image unavailable right now. Trying again every 30 s.</div>
            : !url ? <div className="cam-off">Loading the live image…</div>
              : (
                <button className="cam-open" onClick={() => setZoom(true)} aria-label={`${name}: enlarge the live image`}>
                  <img src={url} alt={alt} referrerPolicy="no-referrer" />
                  <span className="cam-live"><span className="dot" />Live image</span>
                </button>
              )}
      </div>
      <div className="cam-name">{name}</div>
      <div className="cam-where">{where}. Live image, refreshed every 30 s; tap to enlarge.</div>
      {zoom && url && (
        <div className="cam-zoom" role="dialog" aria-modal="true" aria-label={`${name}, live image`}>
          <div className="cam-zoom-scroll" ref={scroller} onClick={() => setZoom(false)}>
            <img src={url} alt={alt} referrerPolicy="no-referrer" />
          </div>
          <div className="cam-zoom-bar">
            <div><strong>{name}</strong><span className="cam-zoom-sub">{where}. Live image, refreshed every 30 s.</span></div>
            <button className="btn ghost small" onClick={() => setZoom(false)} autoFocus>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

const SURF_WORD: Record<SurfCrowd, string> = { none: "none seen", few: "a few", many: "plenty", unclear: "can't tell" };
const SURF_END: Record<"north" | "south", string> = { north: "North end", south: "South end" };

/**
 * Surfeurs à l'eau, lus sur les images des caméras par le modèle de vision, le matin seulement.
 * Affiché pour le jour même ; expérimental tant que la lecture n'est pas jugée contre des images étiquetées.
 */
function SurfLine({ surf, now }: { surf: SurfWatch | null; now: Date }) {
  if (!surf?.at || sydneyDay(new Date(surf.at)) !== sydneyDay(now)) return null;
  const b = surf.budget;
  const tokens = b.inputTokens + b.outputTokens;
  return (
    <div className={`surf-line ${surf.crowd}`} role="status">
      <p className="surf-main"><span className="surf-k">Surfers out</span> <strong>{SURF_WORD[surf.crowd]}</strong> <span className="muted">at {time(new Date(surf.at))}</span></p>
      <ul className="surf-cams">
        {surf.cams.map((c) => <li key={c.id}><span className="muted">{SURF_END[c.id]}:</span> {SURF_WORD[c.crowd]}{c.note ? `, ${c.note.replace(/\.$/, "")}` : ""}</li>)}
      </ul>
      <p className="note">Experimental: a model reads the two images every 30 min from first light to 9:00, {b.cap} times a day at most. Today: {b.looks} {b.looks === 1 ? "reading" : "readings"}{tokens ? `, ${Math.round(tokens / 1000)}k tokens` : ""}. Check it against the images.</p>
    </div>
  );
}

function Cams({ photo, photoAt, offline, surf, now }: { photo: string | null; photoAt: string | null; offline: boolean; surf: SurfWatch | null; now: Date }) {
  return (
    <div className="card">
      <CardHead title="Live cams"><span className="fresh">Randwick City Council</span></CardHead>
      <SurfLine surf={surf} now={now} />
      <div className="cams">
        <CamView id="maroubra_north" name="Maroubra" where="North end of the beach" offline={offline} />
        <CamView id="maroubra_south" name="Maroubra South" where="South end of the beach" offline={offline} />
      </div>
      {photo && <p className="note">Lifeguards' photo this morning ({photoAt ? time(new Date(photoAt)) : ""}): <a href={photo} target="_blank" rel="noreferrer">open</a>.</p>}
      <p className="note">Live video plays on the <a href={CAMS_PAGE} target="_blank" rel="noreferrer">council's cams page</a> only. The cams can go offline in rough weather. Swellnet also runs a free Maroubra cam: <a href="https://www.swellnet.com/surfcams/maroubra" target="_blank" rel="noreferrer">swellnet.com</a>.</p>
    </div>
  );
}

function verdict(b: B, daylight: boolean, closed: boolean): string {
  if (closed) return "Closed today. Stay out of the water.";
  if (!daylight) return "Beach time is over for today.";
  return { Great: "Great for a swim right now.", Good: "Good for a swim right now.", Fair: "Fair: swimmable, with care.", Poor: "Poor conditions for a swim.", "Stay out": "Stay out of the water." }[b.label];
}

interface Props { e: E<B>; status: E<BeachStatus>; tide: TideTable | null; now: Date; buoy: E<Buoy>; near?: E<Buoy>; marine: E<Marine>; surf?: SurfWatch | null; demo: boolean }

export function Beach({ e, status, tide, now, buoy, near, marine, surf = null, demo }: Props) {
  const b = e?.data;
  const official = <OfficialStatus e={status} now={now} />;
  const sea = <SeaSection table={tide} now={now} buoy={buoy} near={near} marine={marine} />;
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
      <div className="card chart-card" style={{ padding: "14px 14px 8px" }}>
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
        <Cams photo={lg?.today ? lg.photo : null} photoAt={lg?.at ?? null} offline={demo} surf={surf} now={now} />
      </div>
      {sea}
    </section>
  );
}
