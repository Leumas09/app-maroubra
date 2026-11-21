// Météo de Maroubra, sur le modèle des fonctions de Google Météo : l'instant, les avertissements officiels,
// l'heure par heure, dix jours que l'on peut choisir, puis des tuiles (pluie, vent, air, UV, soleil, visibilité,
// pression, humidité). Pour « maintenant », les valeurs mesurées à l'aéroport de Sydney (METAR) passent avant le modèle.
import type { AirQuality, Metar, Satellite, SourceEntry, Weather as W, WeatherDay, WeatherHour, WeatherWarnings } from "@maroubra/core";
import { useState, type ReactNode } from "react";
import { cloudText, SatelliteMap } from "../components/SatelliteMap";
import { CardHead, Empty, Fresh, WxIcon, wxText } from "../components/bits";
import { compass, time } from "../lib/format";

type E<T> = (SourceEntry<T> & { stale: boolean; ageMin: number | null }) | null;

const TZ = "Australia/Sydney";
const dayName = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: TZ });
const dayDate = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "numeric", timeZone: TZ });
const longDay = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const hourOf = (t: number) => Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(t * 1000));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const clamp = (x: number) => Math.max(0, Math.min(1, x));

export function aqiLabel(aqi: number | null): string {
  if (aqi == null) return "";
  return aqi <= 50 ? "Good" : aqi <= 100 ? "Moderate" : aqi <= 150 ? "Unhealthy for sensitive groups" : aqi <= 200 ? "Unhealthy" : "Very unhealthy";
}
const uvLabel = (uv: number) => (uv < 3 ? "Low" : uv < 6 ? "Moderate" : uv < 8 ? "High" : uv < 11 ? "Very high" : "Extreme");
/** Visibilité du METAR en milles terrestres (« 6+ ») vers des kilomètres. */
const metarKm = (v: string | null) => (v == null ? null : v.endsWith("+") ? { km: Math.round(parseFloat(v) * 1.609), plus: true } : { km: Math.round(parseFloat(v) * 1.609 * 10) / 10, plus: false });

function Tile({ title, children, note, className = "" }: { title: string; children: ReactNode; note?: string; className?: string }) {
  return (
    <div className={`wx-tile ${className}`}>
      <h3>{title}</h3>
      {children}
      {note && <p className="wx-tile-note">{note}</p>}
    </div>
  );
}

/** Échelle en segments de couleur, avec un repère sur la valeur (UV, qualité de l'air). */
function Segments({ value, max, colors, label }: { value: number; max: number; colors: string[]; label: string }) {
  const at = clamp(value / max);
  return (
    <div className="wx-seg" role="img" aria-label={label}>
      {colors.map((c) => <span key={c} style={{ background: c }} />)}
      <i style={{ left: `${at * 100}%` }} />
    </div>
  );
}

function WindDial({ dir, speed }: { dir: number; speed: number }) {
  // La flèche part du côté d'où vient le vent et pointe là où il va.
  return (
    <svg className="wx-dial" viewBox="0 0 120 120" role="img" aria-label={`Wind from the ${compass(dir)} at ${Math.round(speed)} km/h`}>
      <circle cx="60" cy="60" r="52" fill="none" stroke="var(--rule)" strokeWidth="2" />
      {["N", "E", "S", "W"].map((c, i) => <text key={c} x={60 + 42 * Math.sin((i * Math.PI) / 2)} y={64 - 42 * Math.cos((i * Math.PI) / 2)} textAnchor="middle" fontSize="11" fill="var(--muted)">{c}</text>)}
      <g transform={`rotate(${dir} 60 60)`}>
        <line x1="60" y1="20" x2="60" y2="92" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
        <path d="M60 100 L51 86 L69 86 Z" fill="var(--accent)" />
      </g>
    </svg>
  );
}

function SunArc({ rise, set, now }: { rise: number; set: number; now: number | null }) {
  const W = 200, H = 90, r = 80, cx = W / 2, cy = H - 6;
  const f = now == null ? null : (now - rise) / (set - rise);
  const up = f != null && f >= 0 && f <= 1;
  const a = up ? Math.PI * (1 - f!) : 0;
  return (
    <svg className="wx-sun" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sunrise ${time(new Date(rise * 1000))}, sunset ${time(new Date(set * 1000))}`}>
      <path d={`M${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--rule)" strokeWidth="2" strokeDasharray="4 5" />
      <line x1="4" x2={W - 4} y1={cy} y2={cy} stroke="var(--muted)" strokeWidth="1" />
      {up && <circle cx={cx + r * Math.cos(a)} cy={cy - r * Math.sin(a)} r="8" fill="var(--sun)" />}
    </svg>
  );
}

function PressureGauge({ hpa }: { hpa: number }) {
  // 980 à 1040 hPa sur un arc de 240°.
  const f = clamp((hpa - 980) / 60), start = 150, sweep = 240;
  const pt = (deg: number, rr: number) => [60 + rr * Math.cos((deg * Math.PI) / 180), 60 + rr * Math.sin((deg * Math.PI) / 180)];
  const arc = (from: number, to: number) => { const [x1, y1] = pt(from, 48), [x2, y2] = pt(to, 48); return `M${x1} ${y1} A48 48 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`; };
  const [nx, ny] = pt(start + f * sweep, 48);
  return (
    <svg className="wx-dial" viewBox="0 0 120 110" role="img" aria-label={`Pressure ${Math.round(hpa)} hectopascals`}>
      <path d={arc(start, start + sweep)} fill="none" stroke="var(--slot)" strokeWidth="8" strokeLinecap="round" />
      <path d={arc(start, start + Math.max(1, f * sweep))} fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round" />
      <circle cx={nx} cy={ny} r="7" fill="var(--paper)" stroke="var(--accent)" strokeWidth="3" />
      <text x="60" y="66" textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--ink)">{Math.round(hpa)}</text>
      <text x="60" y="84" textAnchor="middle" fontSize="11" fill="var(--muted)">hPa</text>
    </svg>
  );
}

function HourStrip({ hours, night, nowS }: { hours: WeatherHour[]; night: boolean; nowS: number }) {
  if (!hours.length) return <Empty>No hourly forecast for this day.</Empty>;
  return (
    <ol className="wx-hours" aria-label="Hourly forecast">
      {hours.map((h, i) => (
        <li key={h.t}>
          <span className="wx-h-temp">{Math.round(h.temp)}°</span>
          <WxIcon code={h.code} size={30} night={h.isDay === false || (h.isDay == null && night && i === 0)} />
          <span className="wx-h-pop">{h.pop != null && h.pop >= 10 ? `${h.pop}%` : ""}</span>
          <span className="wx-h-time">{i === 0 && h.t <= nowS ? "Now" : `${String(hourOf(h.t)).padStart(2, "0")}:00`}</span>
        </li>
      ))}
    </ol>
  );
}

export function Weather({ e, metar, air, warnings, sat, night, now }: { e: E<W>; metar: E<Metar>; air: E<AirQuality>; warnings: E<WeatherWarnings>; sat?: E<Satellite>; night: boolean; now: Date }) {
  const w = e?.data;
  const [pick, setPick] = useState(0);
  if (!w) return <section className="card"><CardHead title="Weather"><Fresh e={e} /></CardHead><Empty>Waiting for the forecast.</Empty></section>;
  const c = w.current;
  const m = metar?.data;
  const nowS = now.getTime() / 1000;
  // Dix jours à partir d'aujourd'hui (Open-Meteo donne aussi la veille).
  const days = w.daily.filter((d) => d.t + 86400 > nowS).slice(0, 10);
  const today = days[0];
  const sel: WeatherDay | undefined = days[Math.min(pick, days.length - 1)];
  const isToday = sel === today;
  const hours = isToday ? w.hourly.filter((h) => h.t + 3600 > nowS).slice(0, 24) : w.hourly.filter((h) => sel && h.t >= sel.t && h.t < sel.t + 86400);
  const dayHours = w.hourly.filter((h) => sel && h.t >= sel.t && h.t < sel.t + 86400);
  const dayAqi = (air?.data?.hourly ?? []).filter((h) => sel && h.t >= sel.t && h.t < sel.t + 86400 && h.aqi != null).map((h) => h.aqi!);

  // Valeurs des tuiles : mesures du METAR pour « maintenant », sinon modèle.
  const windSpeed = isToday ? c.wind : sel?.windMax ?? 0;
  const windDir = isToday ? c.windDir : sel?.windDir ?? 0;
  const gust = isToday ? c.gust : sel?.gustMax ?? 0;
  const uvNow = isToday ? c.uv : sel?.uvMax ?? 0;
  const aqi = isToday ? air?.data?.current.aqi ?? null : dayAqi.length ? Math.max(...dayAqi) : null;
  const vis = isToday && m?.visibility ? metarKm(m.visibility) : null;
  const visModel = isToday ? c.visibility ?? null : (() => { const v = dayHours.map((h) => h.visibility).filter((x): x is number => x != null); return v.length ? Math.min(...v) : null; })();
  const pressure = isToday ? m?.qnh ?? c.pressure ?? null : avg(dayHours.map((h) => h.pressure).filter((x): x is number => x != null));
  const humidity = isToday ? c.humidity : avg(dayHours.map((h) => h.humidity));
  const dew = isToday ? m?.dewpoint ?? c.dewPoint ?? null : avg(dayHours.map((h) => h.dewPoint).filter((x): x is number => x != null));
  const measured = "Measured at Sydney Airport";

  return (
    <section aria-labelledby="wx-title" className="wx">
      <div className="wx-now">
        <div>
          <h1 id="wx-title" className="sr-only">Weather at Maroubra</h1>
          <div className="wx-place">Maroubra <Fresh e={e} /></div>
          <div className="wx-cond"><WxIcon code={c.code} size={44} night={night} /> {wxText(c.code)}</div>
        </div>
        <div className="wx-temp">{Math.round(c.temp)}°</div>
        <div className="wx-sub">
          <div>Feels like {Math.round(c.feels)}°</div>
          {today && <div className="muted">High {Math.round(today.max)}° · Low {Math.round(today.min)}°</div>}
        </div>
      </div>

      {(warnings?.data?.items ?? []).map((x) => (
        <div key={x.title} className="wx-warning" role="alert">
          <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L22 20 H2 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 10v5M12 17.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <div>
            <strong>{x.title}</strong>
            <p>{x.statewide ? "Issued for New South Wales; check whether the Sydney area is included. " : ""}Issued {time(new Date(x.at))}. <a href={x.link} target="_blank" rel="noreferrer">Bureau of Meteorology</a></p>
          </div>
        </div>
      ))}

      <div className="card wx-panel">
        <h2>{isToday ? "Hourly forecast" : `Hourly, ${sel ? longDay.format(sel.t * 1000 + 12 * 3600e3) : ""}`}</h2>
        <HourStrip hours={hours} night={night} nowS={nowS} />
        {w.corrected && <p className="note">{w.corrected.note} <a href="#track">How we check this</a>.</p>}
      </div>

      <div className="card wx-panel">
        <h2>10-day forecast</h2>
        <div className="wx-days" role="tablist" aria-label="Pick a day">
          {days.map((d, i) => (
            <button key={d.t} role="tab" aria-selected={sel === d} className="wx-day" onClick={() => setPick(i)}>
              <span className="wx-d-max">{Math.round(d.max)}°</span>
              <span className="wx-d-min">{Math.round(d.min)}°</span>
              <WxIcon code={d.code} size={30} />
              <span className="wx-d-pop">{d.pop != null ? `${d.pop}%` : ""}</span>
              <span className="wx-d-name">{i === 0 ? "Today" : dayName.format(d.t * 1000 + 12 * 3600e3)}</span>
              <span className="wx-d-date">{dayDate.format(d.t * 1000 + 12 * 3600e3)}</span>
            </button>
          ))}
        </div>
      </div>

      {sel && (
        <div className="wx-tiles" aria-label={isToday ? "Conditions now" : `Conditions ${longDay.format(sel.t * 1000 + 12 * 3600e3)}`}>
          <Tile title="Precipitation" note={isToday ? `${w.rainPast24h} mm in the last 24 h` : `Chance of rain ${sel.pop ?? 0}%`}>
            <p className="wx-big">{sel.precip.toFixed(1)}<small> mm</small></p>
            <p className="wx-label">Total rain for the day</p>
          </Tile>
          <Tile title="Wind" note={`Gusts ${Math.round(gust)} km/h`}>
            <WindDial dir={windDir} speed={windSpeed} />
            <p className="wx-label"><strong>{Math.round(windSpeed)} km/h</strong> from the {compass(windDir)}{isToday ? "" : " (max)"}</p>
          </Tile>
          {aqi != null && (
            <Tile title="Air quality" note="Modelled (Copernicus), not measured on site">
              <p className="wx-big">{aqi}</p>
              <Segments value={aqi} max={200} label={`Air quality index ${aqi}, ${aqiLabel(aqi)}`} colors={["var(--good)", "oklch(82% 0.16 95)", "oklch(72% 0.16 60)", "var(--alert)"]} />
              <p className="wx-label">{aqiLabel(aqi)}{isToday ? "" : " (worst hour)"}</p>
            </Tile>
          )}
          <Tile title="UV index" note={isToday ? `Peak ${Math.round(sel.uvMax)} today` : "Daily peak"}>
            <p className="wx-big">{Math.round(uvNow)}</p>
            <Segments value={uvNow} max={13} label={`UV ${Math.round(uvNow)}, ${uvLabel(uvNow)}`} colors={["oklch(70% 0.14 150)", "oklch(82% 0.16 95)", "oklch(72% 0.16 60)", "oklch(60% 0.2 28)", "oklch(52% 0.18 320)"]} />
            <p className="wx-label">{uvLabel(uvNow)}</p>
          </Tile>
          {sel.sunrise != null && sel.sunset != null && (
            <Tile title="Sunrise and sunset">
              <SunArc rise={sel.sunrise} set={sel.sunset} now={isToday ? nowS : null} />
              <p className="wx-label">Rise <strong>{time(new Date(sel.sunrise * 1000))}</strong> · Set <strong>{time(new Date(sel.sunset * 1000))}</strong></p>
            </Tile>
          )}
          {(vis || visModel != null) && (
            <Tile title="Visibility" note={vis ? measured : "Forecast"}>
              <p className="wx-big">{vis ? `${vis.km}${vis.plus ? "+" : ""}` : Math.round(visModel! / 1000)}<small> km</small></p>
              <p className="wx-label">{(vis?.km ?? visModel! / 1000) >= 10 ? "Clear view" : "Reduced"}</p>
            </Tile>
          )}
          {pressure != null && (
            <Tile title="Pressure" note={isToday && m?.qnh != null ? measured : "Forecast"}>
              <PressureGauge hpa={pressure} />
            </Tile>
          )}
          {humidity != null && (
            <Tile title="Humidity" note={isToday && m?.dewpoint != null ? "Dew point measured at Sydney Airport" : undefined}>
              <p className="wx-big">{Math.round(humidity)}<small>%</small></p>
              {dew != null && <p className="wx-label"><span className="wx-dew">{Math.round(dew)}°</span> Dew point</p>}
            </Tile>
          )}
        </div>
      )}

      {sat?.data && (
        <div className="card wx-panel">
          <CardHead title={`Clouds from space, ${time(new Date(sat.data.at))}`}><Fresh e={sat} label="Image" /></CardHead>
          <SatelliteMap s={sat.data} />
          <p style={{ margin: "10px 0 0", lineHeight: 1.45 }}>{cloudText(sat.data)}</p>
          <p className="note">Himawari-9 infrared, day and night: the higher and colder the cloud top, the whiter. Thin high cloud and low fog can be missed.</p>
        </div>
      )}

      {m && (
        <p className="note">
          Sydney Airport at {time(new Date(m.t * 1000))}: {m.temp ?? "n/a"}°C, wind {m.windDir != null ? compass(m.windDir) : "variable"} {m.windKt ?? "?"} kt{m.gustKt ? ` gusting ${m.gustKt}` : ""}, {m.qnh ?? "?"} hPa. <Fresh e={metar} label="Observation" />
          {" "}Forecast: Open-Meteo (best models for Sydney, including the Bureau's ACCESS-G). Warnings: Bureau of Meteorology.
        </p>
      )}
    </section>
  );
}
