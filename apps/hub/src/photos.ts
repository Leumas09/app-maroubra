// Photos d'avions, de la plus juste à la plus générale :
// 1. Planespotters (par adresse OACI, sinon par immatriculation) : nom du photographe et lien obligatoires ;
// 2. adsbdb.com, qui renvoie la photo de l'appareil chez airport-data.com quand elle existe ;
// 3. à défaut, la photo de l'article Wikipédia du modèle (« Similar aircraft »), avec lien vers le fichier
//    (auteur et licence sur sa page). Les images sont servies par leurs sites d'origine ; réponses gardées 24 h.
import type { AircraftPhoto } from "@maroubra/core";
import { fetchJson } from "./http";

interface RawPhoto { thumbnail_large?: { src: string; size: { width: number; height: number } }; thumbnail?: { src: string; size: { width: number; height: number } }; link?: string; photographer?: string }

const TTL_MS = 24 * 3600e3;
const MAX = 800;

const HOSTS = {
  planespotters: /(^|\.)(plnspttrs\.net|planespotters\.net)$/,
  airportData: /(^|\.)airport-data\.com$/,
  wikimedia: /(^|\.)(wikimedia\.org|wikipedia\.org)$/,
};

/** Les images ne doivent venir que des sites autorisés par la CSP de l'app. */
export function okPhotoUrl(u: string | undefined, host: RegExp = HOSTS.planespotters): boolean {
  try {
    const url = new URL(u ?? "");
    return url.protocol === "https:" && host.test(url.hostname);
  } catch {
    return false;
  }
}

interface AdsbdbAircraft { response?: { aircraft?: { url_photo?: string | null; url_photo_thumbnail?: string | null; registration?: string } } | string }

/** Photo de l'appareil chez airport-data.com, via adsbdb. */
export function parseAdsbdbPhoto(j: AdsbdbAircraft): AircraftPhoto | null {
  const a = typeof j.response === "object" ? j.response.aircraft : undefined;
  const src = a?.url_photo ?? a?.url_photo_thumbnail;
  if (!src || !okPhotoUrl(src, HOSTS.airportData)) return null;
  return { kind: "exact", site: "airport-data.com", src, width: 4, height: 3, link: `https://www.airport-data.com/aircraft/${encodeURIComponent(a?.registration ?? "")}.html`, photographer: "airport-data.com" };
}

interface WikiSearch { query?: { pages?: { title: string; thumbnail?: { source: string; width: number; height: number }; pageimage?: string; fullurl?: string }[] } }

/** Photo de l'article Wikipédia du modèle, pour illustrer quand l'appareil lui-même n'a pas de photo. */
export function parseWikiPhoto(j: WikiSearch, typeName: string): AircraftPhoto | null {
  const p = j.query?.pages?.[0];
  if (!p?.thumbnail || !p.pageimage || !okPhotoUrl(p.thumbnail.source, HOSTS.wikimedia)) return null;
  return {
    kind: "type", typeName, site: "Wikimedia Commons", src: p.thumbnail.source, width: p.thumbnail.width, height: p.thumbnail.height,
    link: `https://en.wikipedia.org/wiki/File:${encodeURIComponent(p.pageimage)}`, photographer: p.title,
  };
}

export function parsePhoto(j: { photos?: RawPhoto[] }): AircraftPhoto | null {
  for (const p of j.photos ?? []) {
    const t = p.thumbnail_large ?? p.thumbnail;
    if (!t || !okPhotoUrl(t.src) || !okPhotoUrl(p.link)) continue;
    return { kind: "exact", site: "Planespotters", src: t.src, width: t.size.width, height: t.size.height, link: p.link!, photographer: p.photographer?.trim() || "Unknown photographer" };
  }
  return null;
}

export type PhotoFinder = (hex: string, reg: string | null, typeName?: string | null) => Promise<AircraftPhoto | null>;

type Get = (url: string) => Promise<unknown>;

export function photoFinder(get: Get = (u) => fetchJson(u, { timeoutMs: 8000 })): PhotoFinder {
  const cache = new Map<string, { at: number; photo: AircraftPhoto | null }>();
  /** Réponse gardée 24 h (7 jours pour une photo de modèle) ; `undefined` : erreur passagère, rien n'est gardé. */
  const remember = async (key: string, find: () => Promise<AircraftPhoto | null | undefined>, ttl = TTL_MS) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.photo;
    const photo = await find();
    if (photo === undefined) return null;
    if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), photo });
    return photo;
  };
  const soft = (u: string) => get(u).catch(() => ({}));
  return async (hex, reg, typeName) => {
    const exact = await remember(`${hex}|${reg ?? ""}`, async () => {
      let photo = parsePhoto((await soft(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`)) as { photos?: RawPhoto[] });
      if (!photo && reg) photo = parsePhoto((await soft(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`)) as { photos?: RawPhoto[] });
      if (!photo) photo = parseAdsbdbPhoto((await soft(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(hex)}`)) as AdsbdbAircraft);
      return photo;
    });
    if (exact || !typeName) return exact;
    return remember(`type|${typeName.toLowerCase()}`, async () => {
      const q = encodeURIComponent(`${typeName} aircraft`);
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrsearch=${q}&gsrlimit=1&prop=pageimages|info&piprop=thumbnail|name&pithumbsize=640&inprop=url`;
      const j = await get(url).catch(() => undefined); // Wikipédia limite les appels : on réessaiera plus tard
      return j === undefined ? undefined : parseWikiPhoto(j as WikiSearch, typeName);
    }, 7 * 24 * 3600e3);
  };
}
