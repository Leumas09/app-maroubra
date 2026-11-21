import type { Aircraft, AircraftPhoto, Flights, SourceEntry } from "@maroubra/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardHead, Empty, Fresh } from "../components/bits";
import { FlightMap, HOME, label, type Base } from "../components/FlightMap";
import { requestMotion, SkyFinder } from "../components/SkyFinder";
import { compass } from "../lib/format";
import { distanceKm, Motion } from "../lib/motion";

type E<T> = (SourceEntry<T> & { stale: boolean; ageMin: number | null }) | null;

const ft = (a: Aircraft) => (a.onGround ? "on ground" : a.altFt != null ? `${a.altFt.toLocaleString("en-AU")} ft` : "n/a");
/** Altitude en pieds puis en mètres (fiche de l'avion). */
const ftM = (a: Aircraft) => (a.onGround || a.altFt == null ? ft(a) : `${ft(a)} (${Math.round(a.altFt * 0.3048).toLocaleString("en-AU")} m)`);
const hm = (ms: number) => new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(ms);
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
function usePhoto(hex: string, reg: string | null, typeName: string | null): AircraftPhoto | null | undefined {
  const [p, setP] = useState<AircraftPhoto | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setP(undefined);
    if (!/^[0-9a-f]{6}$/i.test(hex)) { setP(null); return; }
    const key = `${hex}|${reg ?? ""}|${typeName ?? ""}`;
    if (!photos.has(key)) {
      const q = new URLSearchParams({ ...(reg ? { reg } : {}), ...(typeName ? { type: typeName } : {}) });
      photos.set(key, fetch(`/api/aircraft/${hex}/photo?${q}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : { photo: null })).then((j: { photo: AircraftPhoto | null }) => j.photo).catch(() => null));
    }
    photos.get(key)!.then((x) => live && setP(x));
    return () => { live = false; };
  }, [hex, reg, typeName]);
  return p;
}

/** Trace complète de l'avion choisi (jusqu'à 3 h, enregistrée par le hub), relue toutes les 15 s. */
function useTrace(hex: string | null, enabled: boolean): { points: [number, number][]; tookOffAt: number | null } | null {
  const [t, setT] = useState<{ points: [number, number][]; tookOffAt: number | null } | null>(null);
  useEffect(() => {
    setT(null);
    if (!hex || !enabled) return;
    let live = true;
    const load = () => fetch(`/api/aircraft/${encodeURIComponent(hex)}/trace`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { points: [number, number, number, number | null][]; tookOffAt: number | null } | null) => {
        if (live && j) setT({ points: j.points.map((p) => [p[1], p[2]]), tookOffAt: j.tookOffAt });
      }).catch(() => {});
    void load();
    const id = setInterval(load, 15_000);
    return () => { live = false; clearInterval(id); };
  }, [hex, enabled]);
  return t;
}

/** Texte blanc ou presque noir sur la couleur de la compagnie, selon ce qui contraste le mieux (WCAG). */
function inkOn(hex: string): string {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05) >= 4.5 ? "#fff" : "#141414";
}

/** Rayon du relevé de la maison (25 milles nautiques) : au-delà, la carte demande la zone visible. */
const HOME_KM = 46;
type View = { lat: number; lon: number; radiusKm: number };

/**
 * Avions de la zone visible quand la carte sort des environs de la maison : une requête toutes les 10 s
 * tant que la vue ne bouge pas, et des traces construites ici à partir des positions successives.
 */
function useAreaAircraft(view: View | null, enabled: boolean): Aircraft[] {
  const [list, setList] = useState<Aircraft[]>([]);
  const trails = useRef(new Map<string, [number, number][]>());
  const outside = !!view && distanceKm(view.lat, view.lon, HOME[0], HOME[1]) + view.radiusKm > HOME_KM;
  useEffect(() => {
    if (!view || !outside || !enabled) { setList([]); return; }
    let live = true;
    const load = async () => {
      const r = await fetch(`/api/aircraft/area?lat=${view.lat.toFixed(3)}&lon=${view.lon.toFixed(3)}&r=${Math.ceil(view.radiusKm / 1.852)}`, { credentials: "same-origin" }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { aircraft?: Aircraft[] }) : null;
      if (!live || !j?.aircraft) return;
      const seen = new Set<string>();
      setList(j.aircraft.map((a) => {
        seen.add(a.hex);
        const t = trails.current.get(a.hex) ?? [];
        const last = t.at(-1);
        if (!last || last[0] !== a.lat || last[1] !== a.lon) t.push([a.lat, a.lon]);
        trails.current.set(a.hex, t.slice(-60));
        return { ...a, trail: trails.current.get(a.hex)! };
      }));
      for (const hex of trails.current.keys()) if (!seen.has(hex)) trails.current.delete(hex);
    };
    void load();
    const id = setInterval(load, 10_000);
    return () => { live = false; clearInterval(id); };
  }, [view, outside, enabled]);
  return list;
}

function AirlineBadge({ a }: { a: Aircraft }) {
  if (!a.airline) return null;
  return <span className="airline-badge" style={{ background: a.airline.color, color: inkOn(a.airline.color) }} aria-hidden="true">{a.airline.iata}</span>;
}

function Photo({ a }: { a: Aircraft }) {
  const typeName = a.desc ? titleCase(a.desc) : a.type;
  const p = usePhoto(a.hex, a.reg, typeName);
  if (p === null) return null;
  const similar = p?.kind === "type";
  return (
    <figure className="ac-photo">
      <div className="ac-photo-frame" style={{ aspectRatio: p ? `${p.width} / ${p.height}` : "3 / 2" }}>
        {p && <img src={p.src} alt={similar ? `A ${typeName ?? "similar aircraft"}, not this one` : `${a.reg ?? label(a)}, ${typeName ?? "aircraft"}`} referrerPolicy="no-referrer" loading="lazy" />}
        {similar && <span className="ac-photo-tag">Similar aircraft</span>}
      </div>
      {p && (similar
        ? <figcaption>A {typeName}, not this aircraft. Photo <a href={p.link} target="_blank" rel="noopener noreferrer">{p.site}</a></figcaption>
        : <figcaption>Photo <a href={p.link} target="_blank" rel="noopener noreferrer">{p.photographer === p.site ? p.site : `${p.photographer} / ${p.site ?? "Planespotters"}`}</a></figcaption>)}
    </figure>
  );
}

function Selected({ a, tookOffAt, follow, setFollow, openSky }: { a: Aircraft; tookOffAt: number | null; follow: boolean; setFollow: (v: boolean) => void; openSky: () => void }) {
  const off = tookOffAt ?? a.tookOffAt ?? null;
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
            <div><div className="leg-k">From</div><div className="big">{a.route.from?.iata ?? "?"}</div><div className="muted">{a.route.from?.location}</div>{off && <div className="leg-time">Took off {hm(off)}</div>}</div>
            <div style={{ textAlign: "right" }}><div className="leg-k">To</div><div className="big">{a.route.to?.iata ?? "?"}</div><div className="muted">{a.route.to?.location}</div></div>
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
      {!a.route && <p className="muted leg-note">Route not known for this flight{off ? `. Took off at ${hm(off)}` : ""}.</p>}
      <dl className="kv">
        <dt>Aircraft</dt><dd>{a.desc ? titleCase(a.desc) : a.type ?? "n/a"}</dd>
        {a.reg && <><dt>Registration</dt><dd>{a.reg}{a.built ? `, built ${a.built}` : ""}</dd></>}
        {a.operator && a.airline && !a.operator.toLowerCase().includes(a.airline.name.toLowerCase().split(" ")[0]) && <><dt>Operator</dt><dd>{titleCase(a.operator)}</dd></>}
        <dt>Altitude</dt><dd>{ftM(a)}{trend}</dd>
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
  // « Plain » est notre trait de côte local, limité au secteur de Sydney : réservé à la démonstration hors ligne.
  const base: Base = demo ? "plain" : chosen === "plain" ? "map" : chosen;
  const calm = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // Zone visible, arrondie (0,05° et 5 km) pour ne pas relancer de requête à chaque petit déplacement.
  const [view, setView] = useState<View | null>(null);
  const viewKey = useRef("");
  const onView = (v: View) => {
    const r = { lat: Math.round(v.lat * 20) / 20, lon: Math.round(v.lon * 20) / 20, radiusKm: Math.ceil(v.radiusKm / 5) * 5 };
    const k = `${r.lat}|${r.lon}|${r.radiusKm}`;
    if (k !== viewKey.current) { viewKey.current = k; setView(r); }
  };
  const area = useAreaAircraft(view, !demo);

  const motion = useMemo(() => new Motion(), []);
  const home = f?.aircraft ?? NONE;
  const aircraft = useMemo(() => {
    if (!area.length) return home;
    const mine = new Set(home.map((a) => a.hex));
    return [...home, ...area.filter((a) => !mine.has(a.hex))];
  }, [home, area]);
  useEffect(() => { motion.update(aircraft, Date.now()); }, [aircraft, motion]);

  const airborne = home.filter((a) => !a.onGround);
  const emergencies = home.filter((a) => a.emergency);
  // L'avion choisi reste choisi même s'il sort de la zone chargée (on garde sa dernière fiche connue).
  const lastSel = useRef<Aircraft | null>(null);
  const found = sel ? aircraft.find((a) => a.hex === sel) : undefined;
  if (found) lastSel.current = found;
  const s = found ?? (sel && lastSel.current?.hex === sel ? lastSel.current : undefined) ?? emergencies[0] ?? airborne.find((a) => a.overhead) ?? airborne[0];
  const trace = useTrace(s?.hex ?? null, true);

  if (!f) return <section className="card"><CardHead title="Overhead"><Fresh e={e} /></CardHead><Empty>Waiting for aircraft positions.</Empty></section>;
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
      <div className="ov-main">
      <div className="card chart-card map-panel">
        <div className="map-tools">
          <div className="seg" role="group" aria-label="Map background">
            {((demo ? ["map", "satellite", "plain"] : ["map", "satellite"]) as Base[]).map((b) => (
              <button key={b} aria-pressed={base === b} onClick={() => setBase(b)} disabled={demo && b !== "plain"}>{b === "map" ? "Map" : b === "satellite" ? "Satellite" : "Plain"}</button>
            ))}
          </div>
          <div className="map-tools-right">
            <button className="btn ghost small" onClick={() => { setFollow(false); setHomeTick((n) => n + 1); }}>Home</button>
            <button className="btn small" onClick={openSky}>Sky finder</button>
          </div>
        </div>
        <FlightMap aircraft={aircraft} motion={motion} selected={s?.hex ?? null} follow={follow} base={base} night={night} calm={calm}
          onPick={pick} onStopFollow={() => setFollow(false)} homeTick={homeTick} source={f.source ?? "adsb.lol"} onView={onView} selectedTrace={trace?.points ?? null} />
      </div>
        {s && <Selected a={s} tookOffAt={trace?.tookOffAt ?? null} follow={follow} setFollow={setFollow} openSky={() => { setSel(s.hex); openSky(); }} />}
      </div>
      <div className="card nearby">
          <h2>Around Maroubra, nearest first</h2>
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
      {sky && <SkyFinder aircraft={f.aircraft} motion={motion} focus={s?.hex ?? null} onFocus={setSel} onClose={() => setSky(false)} />}
    </section>
  );
}
