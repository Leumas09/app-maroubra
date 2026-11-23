import { Component, lazy as reactLazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import type * as React from "react";
import type { AirQuality, Beach as BeachData, BeachStatus, Brief, Buoy, Fires, Flights, Iss, Marine, Metar, Moment, News as NewsData, Satellite, SpaceWeather, Sunrise, SurfWatch, Verification, Weather as WeatherData, WeatherWarnings } from "@maroubra/core";
import { data, entry, isDemo, useLive } from "./lib/live";
import type { SkyModel } from "./lib/sky-model";
import { loadTide, type TideTable } from "./lib/tide";
import { Home } from "./views/Home";
import { Sky } from "./views/Sky";
/** Une vue qui ne peut pas se charger (hors ligne) n'éteint pas tout l'écran. */
class ViewBoundary extends Component<{ view: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { view: string }) { if (prev.view !== this.props.view && this.state.failed) this.setState({ failed: false }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card">
        <p className="lede" style={{ margin: "0 0 12px" }}>This view could not load. The network may be down.</p>
        <button className="btn" onClick={() => location.reload()}>Retry</button>
      </div>
    );
  }
}

// Vues secondaires chargées à la demande : l'accueil s'affiche sans attendre les cartes ni les tableaux.
// Après un déploiement, un écran resté ouvert peut demander un fichier qui n'existe plus : on recharge
// la page une fois (la nouvelle version arrive), sans boucle si le réseau est vraiment coupé.
function lazy<T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T) {
  return reactLazy(() => load().then((m) => {
    try { sessionStorage.removeItem("mb.reloaded"); } catch { /* ignoré */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { default: m[name] as React.ComponentType<any> };
  }).catch((err) => {
    let again = false;
    try { again = !sessionStorage.getItem("mb.reloaded"); sessionStorage.setItem("mb.reloaded", "1"); } catch { /* ignoré */ }
    if (again) location.reload();
    throw err;
  }));
}
const Beach = lazy(() => import("./views/Beach"), "Beach") as unknown as typeof import("./views/Beach")["Beach"];
const FireAir = lazy(() => import("./views/FireAir"), "FireAir") as unknown as typeof import("./views/FireAir")["FireAir"];
const News = lazy(() => import("./views/News"), "News") as unknown as typeof import("./views/News")["News"];
const Overhead = lazy(() => import("./views/Overhead"), "Overhead") as unknown as typeof import("./views/Overhead")["Overhead"];
const Settings = lazy(() => import("./views/Settings"), "Settings") as unknown as typeof import("./views/Settings")["Settings"];
const TrackRecord = lazy(() => import("./views/TrackRecord"), "TrackRecord") as unknown as typeof import("./views/TrackRecord")["TrackRecord"];
const Weather = lazy(() => import("./views/Weather"), "Weather") as unknown as typeof import("./views/Weather")["Weather"];

type View = "home" | "weather" | "beach" | "sky" | "overhead" | "fire" | "news" | "track" | "settings";
const VIEWS: View[] = ["home", "weather", "beach", "sky", "overhead", "fire", "news", "track", "settings"];

/** `?at=2026-11-14T09:00:00Z` fige l'heure (captures et tests). */
function startTime(): Date | null {
  const at = new URLSearchParams(location.search).get("at");
  return at ? new Date(at) : null;
}

function useNow(): Date {
  const fixed = useMemo(startTime, []);
  const [now, setNow] = useState(() => fixed ?? new Date());
  useEffect(() => {
    if (fixed) return;
    const id = setInterval(() => setNow(new Date()), 30e3);
    return () => clearInterval(id);
  }, [fixed]);
  return now;
}

/** Éphémérides calculées dans un Web Worker, recalculées à chaque minute. */
function useSky(now: Date): SkyModel | null {
  const minute = Math.floor(now.getTime() / 60e3);
  const [sky, setSky] = useState<SkyModel | null>(null);
  const worker = useMemo(() => new Worker(new URL("./lib/sky.worker.ts", import.meta.url), { type: "module" }), []);
  useEffect(() => {
    worker.onmessage = (e: MessageEvent<SkyModel>) => setSky(e.data);
    return () => worker.terminate();
  }, [worker]);
  useEffect(() => worker.postMessage(minute * 60e3), [worker, minute]);
  return sky;
}

/** Écran ambiant : garder l'écran allumé (Screen Wake Lock), le rétablir quand l'onglet revient. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const take = () => navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    const again = () => document.visibilityState === "visible" && take();
    take();
    document.addEventListener("visibilitychange", again);
    return () => { document.removeEventListener("visibilitychange", again); lock?.release().catch(() => {}); };
  }, [on]);
}

const readFlag = (k: string) => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };

export function App() {
  const now = useNow();
  const sky = useSky(now);
  const { snap, connected } = useLive();
  const [tide, setTide] = useState<TideTable | null>(null);
  useEffect(() => { loadTide().then(setTide).catch(() => setTide(null)); }, []);
  const [ambient, setAmbientState] = useState(() => readFlag("mb.ambient"));
  const setAmbient = (v: boolean) => { setAmbientState(v); try { localStorage.setItem("mb.ambient", v ? "1" : "0"); } catch { /* ignoré */ } };
  useWakeLock(ambient);

  const night = sky?.isNight;
  // L'ancienne page Sea fait maintenant partie de Beach : les anciens liens #sea y mènent.
  const fromHash = () => (location.hash === "#sea" ? "beach" : VIEWS.find((v) => location.hash === `#${v}`) ?? null);
  const [view, setView] = useState<View | null>(fromHash);
  useEffect(() => {
    const on = () => setView(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // Vue par défaut : l'accueil « Today » le jour, « Tonight » la nuit.
  const current: View = view ?? "home";

  useEffect(() => {
    if (night === undefined) return;
    document.documentElement.dataset.theme = night ? "night" : "day";
    document.documentElement.dataset.ambient = ambient && night ? "dim" : "";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", night ? "#0A0E16" : "#FAF8F4");
  }, [night, ambient]);

  const go = (v: View) => () => { setView(v); history.replaceState(null, "", `${location.pathname}${location.search}#${v}`); };

  const weather = entry<WeatherData>(snap, "weather");
  const beach = entry<BeachData>(snap, "beach");
  const beachStatus = entry<BeachStatus>(snap, "beachStatus");
  const flights = entry<Flights>(snap, "flights");
  const fires = entry<Fires>(snap, "fires");
  const air = entry<AirQuality>(snap, "air");
  const news = entry<NewsData>(snap, "news");
  const buoy = entry<Buoy>(snap, "buoy");
  const brief = data<Brief>(snap, "brief");
  const activeFires = fires?.data?.nearby.filter((x) => !/out/i.test(x.status)) ?? [];
  const urgentFire = activeFires.some((x) => x.alert === "Emergency Warning" || x.alert === "Watch and Act" || x.smokeTowardUs);

  const serverMoments = data<Moment[]>(snap, "moments") ?? [];
  // Les moments du ciel calculés ici : la prévision de nuages dit s'ils valent la peine.
  const cloudNote = (m: { at: Date; kind: string; detail: string }) => {
    if (!["dark", "planet", "moon"].includes(m.kind)) return m.detail;
    const h = weather?.data?.hourly.find((x) => Math.abs(x.t * 1000 - m.at.getTime()) <= 30 * 60e3);
    const c = h ? (m.kind === "moon" ? h.cloudLow : h.cloud) : null;
    return c != null && c >= 70 ? `${m.detail}. Cloudy (${Math.round(c)}%), likely hidden` : m.detail;
  };
  const moments = [
    ...serverMoments.map((m) => ({ at: new Date(m.at), title: m.title, detail: m.detail, urgent: m.priority === 1 })),
    ...(sky?.moments ?? []).filter((m) => !serverMoments.some((s) => s.title.split(" at ")[0] === m.title)).map((m) => ({ ...m, detail: cloudNote(m), urgent: false })),
  ].filter((m) => m.at.getTime() >= now.getTime() - 15 * 60e3).sort((x, y) => Number(y.urgent) - Number(x.urgent) || x.at.getTime() - y.at.getTime()).slice(0, 8);

  const link = (v: View, label: string, opts: { alert?: string } = {}) => (
    <a key={v} href={`#${v}`} className={opts.alert ? "alert" : undefined} aria-current={current === v ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(v)(); }}>
      {label}{opts.alert ? <span className="sr-only">, {opts.alert}</span> : null}
    </a>
  );

  return (
    <div className="app">
      <aside className="rail">
        <div className="wordmark">Maroubra</div>
        <nav className="rail-main" aria-label="Views">
          {link("home", night ? "Tonight" : "Today")}
          {link("weather", "Weather")}
          {link("beach", "Beach", beachStatus?.data?.status === "closed" ? { alert: "closed today" } : {})}
          {link("sky", "Sky")}
          {link("overhead", "Overhead")}
          {link("fire", "Fire & smoke", urgentFire ? { alert: "check alerts" } : {})}
          {link("news", "News")}
        </nav>
        <nav className="rail-more" aria-label="More">
          {link("track", "Track record")}
          {link("settings", "Settings")}
        </nav>
      </aside>

      <main>
        {/* Toujours présent : l'arrivée des données ne décale pas la page. */}
        <div className="status" role="status">
          {isDemo(snap) && <span className="pill miss">Sample data for testing, not live</span>}
          {snap && !connected && <span className="pill wait">Reconnecting…</span>}
        </div>
        <ViewBoundary view={current}>
        <Suspense fallback={<div className="card" style={{ minHeight: 320 }} aria-busy="true" />}>
        {current === "home" && <Home now={now} sky={sky} brief={brief?.text ?? null} beach={beach} beachStatus={beachStatus} weather={weather} buoy={buoy} marine={entry<Marine>(snap, "marine")} sunrise={entry<Sunrise>(snap, "sunrise")} space={entry<SpaceWeather>(snap, "space")} moments={moments} />}
        {current === "weather" && <Weather e={weather} metar={entry<Metar>(snap, "metar")} air={air} warnings={entry<WeatherWarnings>(snap, "warnings")} sat={entry<Satellite>(snap, "satellite")} night={!!night} now={now} />}
        {current === "beach" && <Beach e={beach} status={beachStatus} tide={tide} now={now} buoy={buoy} near={entry<Buoy>(snap, "buoy-near")} marine={entry<Marine>(snap, "marine")} surf={data<SurfWatch>(snap, "surf")} demo={isDemo(snap)} />}
        {current === "sky" && (sky ? <Sky s={sky} iss={entry<Iss>(snap, "iss")} space={entry<SpaceWeather>(snap, "space")} sunrise={entry<Sunrise>(snap, "sunrise")} hours={weather?.data?.hourly ?? null} /> : <div className="card" style={{ minHeight: 320 }} aria-busy="true" />)}
        {current === "overhead" && <Overhead e={flights} night={!!night} demo={isDemo(snap)} />}
        {current === "fire" && <FireAir fires={fires} />}
        {current === "news" && <News e={news} now={now} />}
        {current === "track" && <TrackRecord live={entry<Verification>(snap, "verify")} />}
        {current === "settings" && <Settings ambient={ambient} setAmbient={setAmbient} />}
        </Suspense>
        </ViewBoundary>
      </main>
    </div>
  );
}
