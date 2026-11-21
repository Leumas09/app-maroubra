// Historique des positions de tous les avions vus par le hub (environs de la maison toutes les 10 s,
// grand rayon de 250 NM toutes les 30 s, zones demandées par la carte). Il donne les traces des vols et
// l'heure de décollage quand on a vu l'avion quitter le sol. adsb.fi ne publie pas de traces en accès libre :
// une trace commence donc au premier passage de l'avion dans notre champ.

/** Point de trace : instant (s), latitude, longitude, altitude en pieds (null au sol). */
export type TracePoint = [t: number, lat: number, lon: number, altFt: number | null];

interface Track { points: TracePoint[]; lastSeen: number; onGround: boolean; tookOffAt: number | null }

const KEEP_S = 3 * 3600; // 3 h de trace
const MIN_STEP_S = 8; // un point toutes les 8 s au plus
const NEW_FLIGHT_GAP_S = 30 * 60; // 30 min sans nouvelles : vol suivant

export interface Sighting { hex: string; lat?: number; lon?: number; alt_baro?: number | "ground"; seen_pos?: number }

export class FlightHistory {
  private tracks = new Map<string, Track>();

  add(list: Sighting[], nowMs: number) {
    for (const r of list) {
      if (r.lat == null || r.lon == null) continue;
      const t = Math.round(nowMs / 1000 - (r.seen_pos ?? 0));
      const ground = r.alt_baro === "ground";
      const alt = typeof r.alt_baro === "number" ? r.alt_baro : null;
      let tr = this.tracks.get(r.hex);
      if (!tr || t - tr.lastSeen > NEW_FLIGHT_GAP_S || (tr.onGround && !ground && tr.points.length && t - tr.points.at(-1)![0] > NEW_FLIGHT_GAP_S)) {
        tr = { points: [], lastSeen: t, onGround: ground, tookOffAt: null };
        this.tracks.set(r.hex, tr);
      }
      // Décollage vu : l'avion était au sol et ne l'est plus. La trace repart de la piste.
      if (tr.onGround && !ground && alt != null) {
        tr.tookOffAt = t * 1000;
        tr.points = tr.points.slice(-1);
      }
      tr.onGround = ground;
      tr.lastSeen = Math.max(tr.lastSeen, t);
      const last = tr.points.at(-1);
      if (!last || t - last[0] >= MIN_STEP_S) tr.points.push([t, Math.round(r.lat * 1e4) / 1e4, Math.round(r.lon * 1e4) / 1e4, ground ? null : alt]);
    }
  }

  /** Points depuis `sinceS` secondes (toute la trace si omis). */
  trace(hex: string, sinceS?: number, nowMs = Date.now()): TracePoint[] {
    const pts = this.tracks.get(hex)?.points ?? [];
    return sinceS == null ? pts : pts.filter((p) => p[0] >= nowMs / 1000 - sinceS);
  }

  /** Trace courte pour la carte : [lat, lon] des 10 dernières minutes. */
  recent(hex: string, nowMs = Date.now()): [number, number][] {
    return this.trace(hex, 600, nowMs).map((p) => [p[1], p[2]]);
  }

  tookOffAt(hex: string): number | null {
    return this.tracks.get(hex)?.tookOffAt ?? null;
  }

  prune(nowMs: number) {
    const now = nowMs / 1000;
    for (const [hex, tr] of this.tracks) {
      if (now - tr.lastSeen > KEEP_S) { this.tracks.delete(hex); continue; }
      const cut = tr.points.findIndex((p) => p[0] >= now - KEEP_S);
      if (cut > 0) tr.points = tr.points.slice(cut);
    }
  }

  get size() { return this.tracks.size; }
}
