import type { Aircraft, AircraftPhoto, Flights, SourceEntry } from "@maroubra/core";
import { useEffect, useMemo, useState } from "react";
import { CardHead, Empty, Fresh } from "../components/bits";
import { FlightMap, label, type Base } from "../components/FlightMap";
import { requestMotion, SkyFinder } from "../components/SkyFinder";
import { compass } from "../lib/format";
import { Motion } from "../lib/motion";

type E<T> = (SourceEntry<T> & { stale: boolean; ageMin: number | null }) | null;

const ft = (a: Aircraft) => (a.onGround ? "on ground" : a.altFt != null ? `${a.altFt.toLocaleString("en-AU")} ft` : "n/a");
const NONE: Aircraft[] = [];
const nf = (n: number) => n.toLocaleString("en-AU");

/** « BOEING 737-800 » devient « Boeing 737-800 » ; les sigles courts restent en capitales. */
const titleCase = (s: string) => s.split(/\s+/).map((w) => (/\d/.test(w) || w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase())).join(" ");

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignoré */ } },
};

// Photos déjà demandées pendant la session (une requête par avion).
const photos = new Map<string, Promise<AircraftPhoto | null>>();
function usePhoto(hex: string, reg: string | null): AircraftPhoto | null | undefined {
  const [p, setP] = useState<AircraftPhoto | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setP(undefined);
    if (!/^[0-9a-f]{6}$/i.test(hex)) { setP(null); return; }
    const key = `${hex}|${reg ?? ""}`;
    if (!photos.has(key)) {
      photos.set(key, fetch(`/api/aircraft/${hex}/photo${reg ? `?reg=${encodeURIComponent(reg)}` : ""}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : { photo: null })).then((j: { photo: AircraftPhoto | null }) => j.photo).catch(() => null));
    }
    photos.get(key)!.then((x) => live && setP(x));
    return () => { live = false; };
  }, [hex, reg]);
  return p;
}

/** Texte blanc ou presque noir sur la couleur de la compagnie, selon ce qui contraste le mieux (WCAG). */
function inkOn(hex: string): string {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05) >= 4.5 ? "#fff" : "#141414";
}

function AirlineBadge({ a }: { a: Aircraft }) {
  if (!a.airline) return null;
  return <span className="airline-badge" style={{ background: a.airline.color, color: inkOn(a.airline.color) }} aria-hidden="true">{a.airline.iata}</span>;
}

function Photo({ a }: { a: Aircraft }) {
  const p = usePhoto(a.hex, a.reg);
  if (p === null) return null;
  return (
    <figure className="ac-photo">
      <div className="ac-photo-frame" style={{ aspectRatio: p ? `${p.width} / ${p.height}` : "3 / 2" }}>
        {p && <img src={p.src} alt={`${a.reg ?? label(a)}, ${a.desc ? titleCase(a.desc) : a.type ?? "aircraft"}`} referrerPolicy="no-referrer" loading="lazy" />}
      </div>
      {p && <figcaption>Photo <a href={p.link} target="_blank" rel="noopener noreferrer">{p.photographer} / Planespotters</a></figcaption>}
    </figure>
  );
}

function Selected({ a, follow, setFollow, openSky }: { a: Aircraft; follow: boolean; setFollow: (v: boolean) => void; openSky: () => void }) {
  const trend = a.vrate == null || a.onGround ? "" : a.vrate > 300 ? `, climbing ${nf(Math.round(a.vrate / 50) * 50)} ft/min` : a.vrate < -300 ? `, descending ${nf(Math.round(-a.vrate / 50) * 50)} ft/min` : ", level";
  const hoursLeft = a.progress && a.speedKt && a.speedKt >= 100 ? a.progress.leftKm / (a.speedKt * 1.852) : null;
  const sub = [a.airline?.name ?? a.operator, a.flightNo && a.callsign ? `callsign ${a.callsign}` : null].filter(Boolean).join(", ");
  return (
    <div className="card ac-card">
      <div className="ac-head">
        <AirlineBadge a={a} />
        <div style={{ minWidth: 0 }}>
          <h2 className="ac-title">{label(a)}</h2>
          {sub && <div className="muted">{sub}</div>}
        </div>
        {a.emergency ? <span className="pill miss">{a.emergency}</span> : a.rare ? <span className="pill good">{a.rare}</span> : null}
      </div>
      <Photo a={a} />
      {a.route && (
        <div className="leg">
          <div className="leg-ends">
            <div><div className="big">{a.route.from?.iata ?? "?"}</div><div className="muted">{a.route.from?.location}</div></div>
            <div style={{ textAlign: "right" }}><div className="big">{a.route.to?.iata ?? "?"}</div><div className="muted">{a.route.to?.location}</div></div>
          </div>
          {a.progress && (
            <>
              <div className="leg-bar" role="img" aria-label={`${Math.round(a.progress.pct)}% of the way from ${a.route.from?.iata} to ${a.route.to?.iata}`}>
                <span className="leg-done" style={{ width: `${a.progress.pct}%` }} />
                <span className="leg-plane" style={{ left: `${a.progress.pct}%` }} />
              </div>
              <p className="muted leg-note">
                {nf(a.progress.flownKm)} km flown, {nf(a.progress.leftKm)} km to go
                {hoursLeft != null ? `, about ${hoursLeft >= 1 ? `${Math.floor(hoursLeft)} h ${String(Math.round((hoursLeft % 1) * 60)).padStart(2, "0")}` : `${Math.max(1, Math.round(hoursLeft * 60))} min`} at current speed` : ""}.
              </p>
            </>
          )}
          {a.route.codes.split("-").length > 2 && <p className="muted leg-note">Full route {a.route.codes.replaceAll("-", " to ")}.</p>}
        </div>
      )}
      <dl className="kv">
        <dt>Aircraft</dt><dd>{a.desc ? titleCase(a.desc) : a.type ?? "n/a"}</dd>
        {a.reg && <><dt>Registration</dt><dd>{a.reg}{a.built ? `, built ${a.built}` : ""}</dd></>}
        {a.operator && a.airline && !a.operator.toLowerCase().includes(a.airline.name.toLowerCase().split(" ")[0]) && <><dt>Operator</dt><dd>{titleCase(a.operator)}</dd></>}
        <dt>Altitude</dt><dd>{ft(a)}{trend}</dd>
        <dt>Speed</dt><dd>{a.speedKt != null ? `${nf(Math.round(a.speedKt * 1.852))} km/h (${Math.round(a.speedKt)} kt)` : "n/a"}</dd>
        {a.track != null && <><dt>Heading</dt><dd>{compass(a.track)} ({Math.round(a.track)}°)</dd></>}
        <dt>Squawk</dt><dd className={a.emergency ? "alert-text" : undefined}>{a.squawk ?? "n/a"}{a.emergency ? `, ${a.emergency.toLowerCase()}` : ""}</dd>
        <dt>From Maroubra</dt><dd>{a.distKm} km {compass(a.bearing)}</dd>
        {a.overhead && <><dt>Overhead</dt><dd>in {a.overhead.inMin} min</dd></>}
        {a.source && <><dt>Position</dt><dd>{a.source}</dd></>}
      </dl>
      <div className="ac-actions">
        <button className={`btn ${follow ? "" : "ghost"}`} aria-pressed={follow} onClick={() => setFollow(!follow)}>{follow ? "Following" : "Follow on map"}</button>
        {!a.onGround && <button className="btn ghost" onClick={openSky}>Find in the sky</button>}
      </div>
    </div>
  );
}

export function Overhead({ e, night, demo }: { e: E<Flights>; night: boolean; demo: boolean }) {
  const f = e?.data;
  const [sel, setSel] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [sky, setSky] = useState(false);
  const [homeTick, setHomeTick] = useState(0);
  const [chosen, setChosen] = useState<Base>(() => (store.get("mb.mapBase") as Base | null) ?? "map");
  const setBase = (b: Base) => { setChosen(b); store.set("mb.mapBase", b); };
  // Données de démonstration : hors ligne, donc sans tuiles.
  const base: Base = demo ? "plain" : chosen;
  const calm = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const motion = useMemo(() => new Motion(), []);
  const aircraft = f?.aircraft ?? NONE;
  useEffect(() => { motion.update(aircraft, Date.now()); }, [aircraft, motion]);

  if (!f) return <section className="card"><CardHead title="Overhead"><Fresh e={e} /></CardHead><Empty>Waiting for aircraft positions.</Empty></section>;
  const airborne = f.aircraft.filter((a) => !a.onGround);
  const emergencies = f.aircraft.filter((a) => a.emergency);
  const s = f.aircraft.find((a) => a.hex === sel) ?? emergencies[0] ?? airborne.find((a) => a.overhead) ?? airborne[0];
  const pick = (hex: string) => { setSel(hex); if (hex !== s?.hex) setFollow(false); };
  const openSky = () => { void requestMotion(); setSky(true); };

  return (
    <section aria-labelledby="ov-title" style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <CardHead title="Above Maroubra"><Fresh e={e} /></CardHead>
        <h1 id="ov-title" className="sr-only">Overhead</h1>
        <p className="lede" style={{ margin: 0 }}>
          {airborne.length} aircraft within 45 km{f.runway ? `. ${f.runway.mode}` : ""}.
          {f.curfew ? " Airport curfew until 06:00: only exempt flights." : ""} {f.seenToday} flights over the suburb today.
        </p>
      </div>
      {emergencies.map((a) => (
        <div key={a.hex} className="card emergency" role="alert">
          <strong>{label(a)}{a.squawk ? ` squawking ${a.squawk}` : ""}: {a.emergency}.</strong>{" "}
          {a.airline?.name ?? a.type ?? "Aircraft"}{a.route ? ` ${a.route.codes}` : ""}, {a.distKm} km {compass(a.bearing)}, {ft(a)}.{" "}
          <button className="link-btn" onClick={() => { pick(a.hex); setFollow(true); }}>Show on map</button>
        </div>
      ))}
      <div className="card chart-scroll map-panel">
        <div className="map-tools">
          <div className="seg" role="group" aria-label="Map background">
            {(["map", "satellite", "plain"] as Base[]).map((b) => (
              <button key={b} aria-pressed={base === b} onClick={() => setBase(b)} disabled={demo && b !== "plain"}>{b === "map" ? "Map" : b === "satellite" ? "Satellite" : "Plain"}</button>
            ))}
          </div>
          <div className="map-tools-right">
            <button className="btn ghost small" onClick={() => { setFollow(false); setHomeTick((n) => n + 1); }}>Home</button>
            <button className="btn small" onClick={openSky}>Sky finder</button>
          </div>
        </div>
        <FlightMap aircraft={f.aircraft} motion={motion} selected={s?.hex ?? null} follow={follow} base={base} night={night} calm={calm}
          onPick={pick} onStopFollow={() => setFollow(false)} homeTick={homeTick} source={f.source ?? "adsb.lol"} />
      </div>
      <div className="grid">
        {s && <Selected a={s} follow={follow} setFollow={setFollow} openSky={() => { setSel(s.hex); openSky(); }} />}
        <div className="card">
          <h2>Nearest first</h2>
          <ul className="list planes">
            {airborne.slice(0, 10).map((a) => (
              <li key={a.hex}>
                <button className={`row-btn${a.emergency ? " is-alert" : ""}`} onClick={() => pick(a.hex)} aria-pressed={a.hex === s?.hex}>
                  <strong>{label(a)}</strong>
                  <span className="muted">{a.emergency ?? a.route?.codes ?? a.type ?? ""}</span>
                  <span>{ft(a)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {sky && <SkyFinder aircraft={f.aircraft} motion={motion} focus={s?.hex ?? null} onFocus={setSel} onClose={() => setSky(false)} />}
    </section>
  );
}
