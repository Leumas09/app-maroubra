import type { LiveScore, SourceEntry, Verification } from "@maroubra/core";
import data from "../data/track-record.json";
import { Fresh } from "../components/bits";
import { shortDate } from "../lib/format";

type E<T> = (SourceEntry<T> & { stale: boolean; ageMin: number | null }) | null;

interface Check {
  name: string;
  target: string;
  result: string;
  pass: boolean;
  status?: "untestable" | "missed";
  judge: string;
  detail?: string;
}

interface LeadRow { lead: number; raw: number; best: number }

interface BenchVerification {
  title: string;
  unit: string;
  test: string;
  best: string;
  gain: number;
  ci: [number, number];
  target: number;
  methods: { name: string; mae: number }[];
  leads: LeadRow[];
}

const checks = data.checks as Check[];
const verifications = data.verifications as BenchVerification[];

function LeadChart({ v }: { v: BenchVerification }) {
  const W = 520, H = 180, P = 34;
  const all = v.leads.flatMap((l) => [l.raw, l.best]);
  const lo = Math.min(...all) * 0.85, hi = Math.max(...all) * 1.08;
  const xs = (i: number) => P + (i / (v.leads.length - 1)) * (W - 2 * P);
  const ys = (e: number) => H - 24 - ((e - lo) / (hi - lo)) * (H - 44);
  const line = (k: "raw" | "best") => v.leads.map((l, i) => `${i ? "L" : "M"}${xs(i)},${ys(l[k])}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Mean absolute error by forecast lead time: raw model against ${v.best}`}>
      <line x1={P} x2={W - P} y1={H - 24} y2={H - 24} stroke="var(--line)" />
      <path d={line("raw")} fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeDasharray="5 5" />
      <path d={line("best")} fill="none" stroke="var(--accent)" strokeWidth="3" />
      {v.leads.map((l, i) => (
        <text key={l.lead} x={xs(i)} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--muted)">{l.lead} h</text>
      ))}
      <text x={W - P} y={ys(v.leads.at(-1)!.raw) - 8} textAnchor="end" fontSize="12" fill="var(--muted)">raw model</text>
      <text x={W - P} y={ys(v.leads.at(-1)!.best) + 18} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--accent)">corrected</text>
    </svg>
  );
}

const STATUS: Record<LiveScore["status"], [string, string]> = { met: ["good", "Met"], missed: ["miss", "Missed"], collecting: ["wait", "Collecting data"] };

/** Erreur moyenne par échéance : modèle brut contre prévision corrigée (scores en production). */
function LiveLeads({ s }: { s: LiveScore }) {
  const leads = s.leads ?? [];
  if (!leads.length) return null;
  const corrected = leads.some((l) => l.corrected != null && l.corrected !== l.raw);
  return (
    <table style={{ marginTop: 8 }}>
      <thead><tr><th scope="col">Ahead</th><th scope="col">Hours</th><th scope="col">Raw model ({s.unit})</th>{corrected && <th scope="col">Corrected</th>}</tr></thead>
      <tbody>{leads.map((l) => (
        <tr key={l.lead}><td>{l.lead}</td><td>{l.n.toLocaleString("en-AU")}</td><td>{l.raw.toFixed(2)}</td>{corrected && <td><strong>{l.corrected?.toFixed(2) ?? "n/a"}</strong></td>}</tr>
      ))}</tbody>
    </table>
  );
}

function Live({ e }: { e: E<Verification> }) {
  const v = e?.data;
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Live, last {v?.windowDays ?? 30} days</h2><Fresh e={e} label="Checked" /></div>
        {!v ? <p className="muted" style={{ margin: 0 }}>Waiting for the first check of the archive.</p> : (
          <div>
            <table className="live-table">
              <thead><tr><th scope="col">Check</th><th scope="col" className="target">Target</th><th scope="col">Result</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {v.scores.map((s) => (
                  <tr key={s.key}>
                    <td>{s.title}<div className="muted" style={{ fontSize: 12 }}>{s.judge}{s.since ? `, since ${shortDate(new Date(s.since))}` : ""}</div><div className="muted target-inline" style={{ fontSize: 12 }}>Target: {s.target}</div></td>
                    <td className="target">{s.target}</td>
                    <td>{s.result}</td>
                    <td><span className={`pill ${STATUS[s.status][0]}`}>{STATUS[s.status][1]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Since the screen went live, it archives every forecast it shows and every observation it receives. This table is recomputed from that archive every three hours.</p>
      </div>
      {v && (
        <div className="grid">
          {v.scores.filter((s) => s.status !== "collecting" || s.n > 0).map((s) => (
            <div className="card" key={s.key}>
              <h2>{s.title}</h2>
              <div className="big" style={{ fontSize: 26 }}>{s.result}</div>
              <p className="sub" style={{ margin: "6px 0 0", lineHeight: 1.45 }}>{s.detail}</p>
              <LiveLeads s={s} />
              {(s.key === "temp" || s.key === "wind") && (
                <p className="note">
                  On screen: {v.correction[s.key].on ? "corrected" : "raw model"}. {v.correction[s.key].why}.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function TrackRecord({ live }: { live: E<Verification> }) {
  return (
    <section aria-labelledby="tr-title" style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h1 id="tr-title" style={{ margin: "0 0 8px", fontSize: 15, color: "var(--muted)" }}>Track record</h1>
        <p className="lede">Every forecast this screen makes is checked against what really happened. Missed targets stay on this page.</p>
      </div>
      <Live e={live} />
      <div className="card">
        <h2>Before launch: the test bench</h2>
        <p className="note" style={{ marginTop: 0, marginBottom: 12 }}>Updated {data.generated}, on data the methods never saw while learning. Weather judged against Sydney Airport observations (NOAA ISD), waves against the Sydney Waverider buoy (Manly Hydraulics Laboratory, via AODN), sky against Skyfield with the JPL DE421 ephemeris.</p>
        <div>
          <table className="live-table">
            <thead><tr><th scope="col">Check</th><th scope="col" className="target">Target</th><th scope="col">Result</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}<div className="muted" style={{ fontSize: 12 }}>{c.judge}</div><div className="muted target-inline" style={{ fontSize: 12 }}>Target: {c.target}</div></td>
                  <td className="target">{c.target}</td>
                  <td>{c.result}</td>
                  <td><span className={`pill ${c.pass ? "good" : c.status === "untestable" ? "wait" : "miss"}`}>{c.pass ? "Met" : c.status === "untestable" ? "Not testable yet" : "Missed"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid">
        {verifications.map((v) => (
          <div className="card" key={v.title}>
            <h2>{v.title}</h2>
            {v.gain > 0 ? (
              <>
                <div className="big">−{(v.gain * 100).toFixed(1)}%</div>
                <p className="sub" style={{ margin: "4px 0 12px" }}>
                  error vs raw model ({v.best}), 95% interval {(v.ci[0] * 100).toFixed(1)} to {(v.ci[1] * 100).toFixed(1)}%. Target −{v.target * 100}%.
                </p>
              </>
            ) : (
              <>
                <div className="big">Raw model kept</div>
                <p className="sub" style={{ margin: "4px 0 12px" }}>No correction beat the raw model on the held-out year: it is unbiased here, so the screen uses it as is.</p>
              </>
            )}
            <LeadChart v={v} />
            <table style={{ marginTop: 8 }}>
              <thead><tr><th scope="col">Method</th><th scope="col">Mean error ({v.unit})</th></tr></thead>
              <tbody>{v.methods.map((m) => <tr key={m.name}><td>{m.name}</td><td>{m.mae.toFixed(2)}</td></tr>)}</tbody>
            </table>
            <p className="note">Held-out test: {v.test}.</p>
          </div>
        ))}
      </div>
    </section>
  );
}
