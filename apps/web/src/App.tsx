import { useEffect, useMemo, useState } from "react";
import type { AirQuality, Beach as BeachData, Brief, Buoy, Fires, Flights, Iss, Marine, Metar, Moment, News as NewsData, Satellite, SpaceWeather, Sunrise, Verification, Weather as WeatherData } from "@maroubra/core";
import { data, entry, isDemo, useLive } from "./lib/live";
import type { SkyModel } from "./lib/sky-model";
import { loadTide, type TideTable } from "./lib/tide";
import { Beach } from "./views/Beach";
import { Home } from "./views/Home";
import { FireAir } from "./views/FireAir";
import { News } from "./views/News";
import { Overhead } from "./views/Overhead";
import { Settings } from "./views/Settings";
import { Sky } from "./views/Sky";
import { Sea } from "./views/Tide";
import { TrackRecord } from "./views/TrackRecord";
import { Weather } from "./views/Weather";

type View = "home" | "weather" | "beach" | "sea" | "sky" | "overhead" | "fire" | "news" | "track" | "settings";
const VIEWS: View[] = ["home", "weather", "beach", "sea", "sky", "overhead", "fire", "news", "track", "settings"];

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
  const fromHash = () => VIEWS.find((v) => location.hash === `#${v}`) ?? null;
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
  const flights = entry<Flights>(snap, "flights");
  const fires = entry<Fires>(snap, "fires");
  const air = entry<AirQuality>(snap, "air");
  const news = entry<NewsData>(snap, "news");
  const buoy = entry<Buoy>(snap, "buoy");
  const brief = data<Brief>(snap, "brief");
  const activeFires = fires?.data?.nearby.filter((x) => !/out/i.test(x.status)) ?? [];
  const urgentFire = activeFires.some((x) => x.alert === "Emergency Warning" || x.alert === "Watch and Act" || x.smokeTowardUs);

  const serverMoments = data<Moment[]>(snap, "moments") ?? [];
  const moments = [
    ...serverMoments.map((m) => ({ at: new Date(m.at), title: m.title, detail: m.detail, urgent: m.priority === 1 })),
    ...(sky?.moments ?? []).filter((m) => !serverMoments.some((s) => s.title.split(" at ")[0] === m.title)).map((m) => ({ ...m, urgent: false })),
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
          {link("beach", "Beach")}
          {link("sea", "Sea")}
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
        {current === "home" && <Home now={now} sky={sky} brief={brief?.text ?? null} beach={beach} weather={weather} buoy={buoy} marine={entry<Marine>(snap, "marine")} sunrise={entry<Sunrise>(snap, "sunrise")} space={entry<SpaceWeather>(snap, "space")} moments={moments} />}
        {current === "weather" && <Weather e={weather} metar={entry<Metar>(snap, "metar")} air={air} sat={entry<Satellite>(snap, "satellite")} night={!!night} />}
        {current === "beach" && <Beach e={beach} now={now} />}
        {current === "sea" && <Sea table={tide} now={now} buoy={buoy} marine={entry<Marine>(snap, "marine")} />}
        {current === "sky" && (sky ? <Sky s={sky} iss={entry<Iss>(snap, "iss")} space={entry<SpaceWeather>(snap, "space")} sunrise={entry<Sunrise>(snap, "sunrise")} /> : <div className="card" style={{ minHeight: 320 }} aria-busy="true" />)}
        {current === "overhead" && <Overhead e={flights} />}
        {current === "fire" && <FireAir fires={fires} />}
        {current === "news" && <News e={news} now={now} />}
        {current === "track" && <TrackRecord live={entry<Verification>(snap, "verify")} />}
        {current === "settings" && <Settings ambient={ambient} setAmbient={setAmbient} />}
      </main>
    </div>
  );
}
