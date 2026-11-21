// État en direct venu du hub : instantané complet puis mises à jour par Server-Sent Events.
// Le hub ferme le flux toutes les 200 s (plafond de Container Apps) : EventSource se reconnecte seul.
import { useEffect, useState } from "react";
import type { Snapshot, SourceEntry } from "@maroubra/core";

export function useLive(): { snap: Snapshot | null; connected: boolean } {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let build: string | null = null;
    const open = () => {
      es = new EventSource("/api/stream");
      es.addEventListener("snapshot", (e) => {
        const next = JSON.parse((e as MessageEvent).data) as Snapshot & { build?: string };
        // Nouvelle version mise en production : l'écran se recharge seul pour la prendre.
        if (next.build && next.build !== "dev") {
          if (build && build !== next.build) { location.reload(); return; }
          build = next.build;
        }
        setSnap(next);
        setConnected(true);
      });
      es.addEventListener("patch", (e) => {
        const { id, entry, version } = JSON.parse((e as MessageEvent).data) as { id: string; entry: SourceEntry; version: number };
        setSnap((s) => (s ? { version, sources: { ...s.sources, [id]: entry } } : s));
      });
      es.onerror = async () => {
        setConnected(false);
        // Session expirée : EventSource ne voit pas le 401, on le vérifie nous-mêmes.
        const r = await fetch("/api/state", { credentials: "same-origin" }).catch(() => null);
        if (r?.status === 401 && !closed) location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
      };
    };
    open();
    return () => { closed = true; es?.close(); };
  }, []);
  // Le flux se reconnecte toutes les 200 s (plafond de Container Apps) : on ne signale la coupure
  // qu'au-delà de 5 s, pour que l'écran ambiant ne clignote pas.
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (connected) { setLost(false); return; }
    const id = setTimeout(() => setLost(true), 5000);
    return () => clearTimeout(id);
  }, [connected]);
  return { snap, connected: !lost };
}

export function entry<T>(snap: Snapshot | null, id: string): (SourceEntry<T> & { stale: boolean; ageMin: number | null }) | null {
  const e = snap?.sources[id] as SourceEntry<T> | undefined;
  if (!e) return null;
  const age = e.updatedAt ? (Date.now() - Date.parse(e.updatedAt)) / 60e3 : null;
  return { ...e, ageMin: age, stale: age == null || age * 60e3 > e.staleAfterMs };
}

export function data<T>(snap: Snapshot | null, id: string): T | null {
  return (snap?.sources[id]?.data as T) ?? null;
}

export const isDemo = (snap: Snapshot | null) => Boolean((snap as unknown as { demo?: boolean })?.demo);
