// Mouvement des avions entre deux relevés, et géométrie du ciel pour le viseur (« Sky finder »).
// Le hub envoie une position toutes les 10 s ; l'app prolonge chaque avion en ligne droite à sa vitesse sol,
// puis fond l'écart quand la position suivante arrive, pour que rien ne saute à l'écran.
import type { Aircraft } from "@maroubra/core";

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function destination(lat: number, lon: number, bearing: number, km: number): [number, number] {
  const d = km / R_KM, b = rad(bearing), p1 = rad(lat), l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), deg(l2)];
}

/** Au-delà, on ne prolonge plus : la position est trop vieille (ou l'heure est figée pour une capture). */
export const MAX_EXTRAPOLATE_S = 240;

type Moving = Pick<Aircraft, "lat" | "lon" | "posAt" | "speedKt" | "track" | "onGround">;

/** Position estimée à l'instant t, en ligne droite à la vitesse sol depuis la dernière position reçue. */
export function deadReckon(a: Moving, t: number): [number, number] {
  const age = (t - a.posAt) / 1000;
  if (a.onGround || a.speedKt == null || a.track == null || age <= 0 || age > MAX_EXTRAPOLATE_S) return [a.lat, a.lon];
  return destination(a.lat, a.lon, a.track, (a.speedKt * 1.852 * age) / 3600);
}

/** Écart fondu en 1 s environ quand une nouvelle position remplace l'estimation. */
const BLEND_MS = 900;

export class Motion {
  private ac = new Map<string, Aircraft>();
  private off = new Map<string, { dLat: number; dLon: number; at: number }>();

  update(list: Aircraft[], t: number) {
    const next = new Map(list.map((a) => [a.hex, a]));
    for (const a of list) {
      const prev = this.ac.has(a.hex) ? this.pos(a.hex, t) : null;
      const [la, lo] = deadReckon(a, t);
      // Un saut de plus de 5 km n'est pas un mouvement à lisser (avion réapparu, position corrigée).
      if (prev && distanceKm(prev[0], prev[1], la, lo) < 5) this.off.set(a.hex, { dLat: prev[0] - la, dLon: prev[1] - lo, at: t });
      else this.off.delete(a.hex);
    }
    for (const hex of this.ac.keys()) if (!next.has(hex)) this.off.delete(hex);
    this.ac = next;
  }

  pos(hex: string, t: number): [number, number] | null {
    const a = this.ac.get(hex);
    if (!a) return null;
    const [la, lo] = deadReckon(a, t);
    const o = this.off.get(hex);
    if (!o) return [la, lo];
    const k = Math.exp(-(t - o.at) / BLEND_MS * 3);
    return k < 0.01 ? [la, lo] : [la + o.dLat * k, lo + o.dLon * k];
  }
}

// ---------- Ciel : directions vues depuis le sol ----------

export interface Look { az: number; el: number; distKm: number }

/** Azimut et hauteur d'un avion vus d'un point au sol, avec la courbure de la Terre. */
export function lookAngles(obs: { lat: number; lon: number; altM?: number }, lat: number, lon: number, altFt: number): Look {
  const d = Math.max(0.01, distanceKm(obs.lat, obs.lon, lat, lon));
  const h = altFt * 0.0003048 - (obs.altM ?? 20) / 1000 - (d * d) / (2 * R_KM);
  return { az: bearingDeg(obs.lat, obs.lon, lat, lon), el: deg(Math.atan2(h, d)), distKm: Math.hypot(d, h) };
}

type V3 = [number, number, number]; // est, nord, haut
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const dirVec = (az: number, el: number): V3 => [Math.sin(rad(az)) * Math.cos(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el))];

/** Repère de la caméra : vers l'avant, vers la droite et vers le haut de l'écran, en coordonnées est, nord, haut. */
export interface Camera { fwd: V3; right: V3; up: V3 }

/** Caméra sans roulis pointée vers un azimut et une hauteur (mode « glisser pour regarder »). */
export function cameraAt(az: number, el: number): Camera {
  const fwd = dirVec(az, el);
  const right: V3 = [Math.cos(rad(az)), -Math.sin(rad(az)), 0];
  const up = dirVec(az, el + 90);
  return { fwd, right, up };
}

/**
 * Caméra arrière du téléphone d'après les angles W3C (alpha, bêta, gamma : rotations Z, X', Y'').
 * `heading` remplace l'azimut quand le système donne un cap boussole (iOS : webkitCompassHeading).
 * `screenAngle` : rotation de l'écran (paysage), `yawOffset` : réglage à la main par glissement.
 */
export function cameraFromOrientation(alpha: number, beta: number, gamma: number, opts: { heading?: number | null; screenAngle?: number; yawOffset?: number } = {}): Camera {
  const [ca, sa, cb, sb, cg, sg] = [Math.cos(rad(alpha)), Math.sin(rad(alpha)), Math.cos(rad(beta)), Math.sin(rad(beta)), Math.cos(rad(gamma)), Math.sin(rad(gamma))];
  // Colonnes de R = Rz(alpha) Rx(beta) Ry(gamma) : axes X, Y, Z du téléphone dans le repère terrestre.
  const X: V3 = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg];
  const Y: V3 = [-sa * cb, ca * cb, sb];
  const Z: V3 = [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg];
  const fwd: V3 = [-Z[0], -Z[1], -Z[2]];
  const th = rad(opts.screenAngle ?? 0);
  let right: V3 = [Math.cos(th) * X[0] - Math.sin(th) * Y[0], Math.cos(th) * X[1] - Math.sin(th) * Y[1], Math.cos(th) * X[2] - Math.sin(th) * Y[2]];
  let up: V3 = [Math.sin(th) * X[0] + Math.cos(th) * Y[0], Math.sin(th) * X[1] + Math.cos(th) * Y[1], Math.sin(th) * X[2] + Math.cos(th) * Y[2]];
  // Rotation autour de la verticale : cap boussole fourni, puis réglage manuel.
  const azNow = deg(Math.atan2(fwd[0], fwd[1]));
  const yaw = rad((opts.heading != null ? opts.heading - azNow : 0) + (opts.yawOffset ?? 0));
  const spin = (v: V3): V3 => [v[0] * Math.cos(yaw) + v[1] * Math.sin(yaw), -v[0] * Math.sin(yaw) + v[1] * Math.cos(yaw), v[2]];
  right = spin(right); up = spin(up);
  return { fwd: spin(fwd), right, up };
}

export const cameraAz = (c: Camera) => (deg(Math.atan2(c.fwd[0], c.fwd[1])) + 360) % 360;
export const cameraEl = (c: Camera) => deg(Math.asin(Math.max(-1, Math.min(1, c.fwd[2]))));

/** Projection perspective sur l'écran (w × h pixels, champ vertical vfov). Null derrière la caméra. */
export function project(c: Camera, az: number, el: number, w: number, h: number, vfov: number): { x: number; y: number; inView: boolean } | null {
  const v = dirVec(az, el);
  const z = dot(v, c.fwd);
  if (z <= 0.02) return null;
  const fy = h / 2 / Math.tan(rad(vfov) / 2);
  const x = w / 2 + (dot(v, c.right) / z) * fy;
  const y = h / 2 - (dot(v, c.up) / z) * fy;
  return { x, y, inView: x >= 0 && x <= w && y >= 0 && y <= h };
}
