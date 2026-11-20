// Photos d'avions : API publique de Planespotters (par adresse OACI, sinon par immatriculation).
// Conditions : afficher le nom du photographe et un lien vers la photo, servir l'image depuis leur serveur.
// On garde les réponses 24 h en mémoire pour ne pas solliciter l'API à chaque clic.
import type { AircraftPhoto } from "@maroubra/core";
import { fetchJson } from "./http";

interface RawPhoto { thumbnail_large?: { src: string; size: { width: number; height: number } }; thumbnail?: { src: string; size: { width: number; height: number } }; link?: string; photographer?: string }

const TTL_MS = 24 * 3600e3;
const MAX = 800;

/** Les images ne doivent venir que des serveurs de Planespotters (la CSP de l'app ne les autorise que là). */
export function okPhotoUrl(u: string | undefined): boolean {
  try {
    const url = new URL(u ?? "");
    return url.protocol === "https:" && /(^|\.)(plnspttrs\.net|planespotters\.net)$/.test(url.hostname);
  } catch {
    return false;
  }
}

export function parsePhoto(j: { photos?: RawPhoto[] }): AircraftPhoto | null {
  for (const p of j.photos ?? []) {
    const t = p.thumbnail_large ?? p.thumbnail;
    if (!t || !okPhotoUrl(t.src) || !okPhotoUrl(p.link)) continue;
    return { src: t.src, width: t.size.width, height: t.size.height, link: p.link!, photographer: p.photographer?.trim() || "Unknown photographer" };
  }
  return null;
}

export type PhotoFinder = (hex: string, reg: string | null) => Promise<AircraftPhoto | null>;

export function photoFinder(get: (url: string) => Promise<{ photos?: RawPhoto[] }> = (u) => fetchJson(u, { timeoutMs: 8000 })): PhotoFinder {
  const cache = new Map<string, { at: number; photo: AircraftPhoto | null }>();
  return async (hex, reg) => {
    const key = `${hex}|${reg ?? ""}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.photo;
    let photo = parsePhoto(await get(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`));
    if (!photo && reg) photo = parsePhoto(await get(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`));
    if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), photo });
    return photo;
  };
}
