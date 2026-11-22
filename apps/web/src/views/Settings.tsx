import { useEffect, useState } from "react";
import type { Moment } from "@maroubra/core";
// Numéro de version de l'app (package.json racine), incrémenté à chaque mise en production.
import { version as release } from "../../../../package.json";
import { DEFAULT_WINDOWS, MAX_WINDOWS, loadBusWindows, normalizeWindows, saveBusWindows, type BusWindow } from "../lib/bus";

const KINDS: { id: Moment["kind"]; label: string }[] = [
  { id: "beach", label: "Best time to swim" },
  { id: "sun", label: "Sunrise worth getting up for" },
  { id: "moon", label: "Moonrise over the sea" },
  { id: "iss", label: "Space Station passes" },
  { id: "aurora", label: "Aurora alerts" },
  { id: "rain", label: "Rain within the hour" },
  { id: "plane", label: "Unusual aircraft overhead, emergencies nearby" },
  { id: "fire", label: "Bushfires and smoke nearby" },
];
const DEFAULT: Moment["kind"][] = ["beach", "aurora", "fire", "iss", "moon", "rain"];

function b64ToUint8(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

const hmAdd = (hm: string, min: number) => { const m = Math.min(23 * 60 + 59, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) + min); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

/** Plages horaires du bandeau des bus de l'accueil, enregistrées sur cet appareil dès qu'elles sont valides. */
function BusWindows() {
  const [rows, setRows] = useState<BusWindow[]>(loadBusWindows);
  const valid = normalizeWindows(rows);
  const update = (next: BusWindow[]) => { setRows(next); const n = normalizeWindows(next); if (n) saveBusWindows(n); };
  const set = (i: number, j: 0 | 1, v: string) => update(rows.map((w, k) => (k === i ? (j === 0 ? [v, w[1]] : [w[0], v]) : w)));
  const add = () => { const start = hmAdd(rows[rows.length - 1]?.[1] ?? "06:45", 30); update([...rows, [start, hmAdd(start, 30)]]); };
  const isDefault = JSON.stringify(valid) === JSON.stringify(DEFAULT_WINDOWS);
  return (
    <div className="card">
      <h2>Buses on Home</h2>
      <p className="muted" style={{ margin: "0 0 10px" }}>The 396 and 396X from Maroubra Rd after Hereward St towards Maroubra Junction, on weekdays. Choose the times to show; after the last one, Home shows the next weekday.</p>
      <div className="bus-set">
        {rows.map(([a, b], i) => (
          <div className="bus-set-row" key={i}>
            <input type="time" step={60} value={a} aria-label={`Window ${i + 1} start`} onChange={(e) => set(i, 0, e.target.value)} />
            <span className="muted">to</span>
            <input type="time" step={60} value={b} aria-label={`Window ${i + 1} end`} onChange={(e) => set(i, 1, e.target.value)} />
            {rows.length > 1 ? <button className="btn ghost bus-set-del" aria-label={`Remove window ${i + 1}`} title="Remove" onClick={() => update(rows.filter((_, k) => k !== i))}>×</button> : <span />}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        {rows.length < MAX_WINDOWS && <button className="btn ghost small" onClick={add}>Add a time window</button>}
        {!isDefault && <button className="btn ghost small" onClick={() => { saveBusWindows(null); setRows(DEFAULT_WINDOWS); }}>Reset to {DEFAULT_WINDOWS.map(([a, b]) => `${a} to ${b}`).join(" and ")}</button>}
      </div>
      <p className="note" role="status">{valid ? "Saved on this device." : "Each window needs an end time after its start time. Not saved yet."}</p>
    </div>
  );
}

export function Settings({ ambient, setAmbient }: { ambient: boolean; setAmbient: (v: boolean) => void }) {
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [kinds, setKinds] = useState<Moment["kind"][]>(() => load("mb.kinds", DEFAULT));
  const [quiet, setQuiet] = useState<boolean>(() => load("mb.quiet", true));
  const [status, setStatus] = useState<string>("");
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setOn(!!s)).catch(() => {});
  }, [supported]);

  async function enable() {
    setStatus("Asking for permission…");
    try {
      if ((await Notification.requestPermission()) !== "granted") { setStatus("Notifications are blocked in this browser's settings."); return; }
      const { publicKey } = await (await fetch("/api/push/key")).json();
      if (!publicKey) { setStatus("Notifications are not configured on the server yet."); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey) as BufferSource }));
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub, prefs: { kinds, quiet } }) });
      save("mb.kinds", kinds); save("mb.quiet", quiet);
      setOn(true);
      setStatus("Notifications are on for this device.");
    } catch (err) {
      setStatus(`Could not turn notifications on: ${(err as Error).message}`);
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setOn(false);
    setStatus("Notifications are off for this device.");
  }

  async function test() {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (!sub) return;
    const r = await (await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) })).json();
    setStatus(r.ok ? "Test sent. It should arrive in a few seconds." : "The test could not be sent.");
  }

  return (
    <section aria-labelledby="settings-title" style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h1 id="settings-title" style={{ margin: "0 0 12px", fontSize: 15, color: "var(--muted)" }}>This device</h1>
        <div className="check">
          <input id="ambient" type="checkbox" checked={ambient} onChange={(e) => setAmbient(e.target.checked)} />
          <label htmlFor="ambient">Ambient display: keep the screen on and dim it at night (for the desk tablet)</label>
        </div>
      </div>
      <BusWindows />
      <div className="card">
        <h2>Notifications</h2>
        {!supported ? (
          <p className="muted" style={{ margin: 0 }}>This browser cannot receive notifications. On iPhone, add Maroubra to the Home Screen first (Share, Add to Home Screen), then open it from there.</p>
        ) : (
          <>
            <fieldset className="kinds">
              <legend className="muted">Tell me about</legend>
              {KINDS.map((k) => (
                <div className="check" key={k.id}>
                  <input id={`k-${k.id}`} type="checkbox" checked={kinds.includes(k.id)} onChange={(e) => setKinds((ks) => (e.target.checked ? [...ks, k.id] : ks.filter((x) => x !== k.id)))} />
                  <label htmlFor={`k-${k.id}`}>{k.label}</label>
                </div>
              ))}
              <div className="check">
                <input id="quiet" type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
                <label htmlFor="quiet">Quiet from 21:30 to 07:00, except urgent alerts</label>
              </div>
            </fieldset>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              <button className="btn" onClick={enable}>{on ? "Save choices" : "Turn on notifications"}</button>
              {on && <button className="btn ghost" onClick={test}>Send a test</button>}
              {on && <button className="btn ghost" onClick={disable}>Turn off</button>}
            </div>
            <p className="note" role="status">{status || "At most three a day, only when something is worth it."}</p>
          </>
        )}
      </div>
      <div className="card">
        <h2>Account</h2>
        <form method="post" action="/logout"><button className="btn ghost" type="submit">Sign out of this device</button></form>
        <p className="note">Maroubra version {release}</p>
      </div>
    </section>
  );
}
