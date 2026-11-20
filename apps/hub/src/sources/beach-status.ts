// Statut officiel de Maroubra, trois sources indépendantes :
// - rapport du matin des sauveteurs de Randwick City Council (flux RSS, un <item> par plage, publié vers 7 h) ;
// - prévision de pollution NSW Beachwatch (API publique GeoJSON, CC BY 4.0, mise à jour vers 6 h et 13 h 30) ;
// - horaires de surveillance et note de danger Beachsafe (Surf Life Saving Australia, JSON non documenté, au mieux).
// Le rapport des sauveteurs fait foi pour « ouverte » ou « fermée ». S'il n'est pas du jour, le statut reste inconnu.
import type { BeachStatus } from "@maroubra/core";
import { fetchJson, fetchText } from "../http";
import type { Collector } from "../collector";

export const LIFEGUARD_FEED = "https://www.randwick.nsw.gov.au/integration/feeds/lifeguard-reports";
export const BEACHWATCH = "https://api.beachwatch.nsw.gov.au/public/sites/geojson?site_name=Maroubra%20Beach";
export const BEACHSAFE = "https://beachsafe.org.au/api/v4/beach/maroubra";
// Le flux de la mairie est derrière Cloudflare : un agent de navigateur passe mieux qu'un robot déclaré.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const sydneyDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(d);
const decode = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? null;

/** Champs « <strong>Clé:</strong> valeur » de la description HTML d'un rapport. */
export function reportFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = decode(html);
  for (const m of clean.matchAll(/<strong>\s*([^<:]+?)\s*:?\s*<\/strong>\s*:?\s*([\s\S]*?)(?=<strong>|<\/p>|$)/gi)) {
    const v = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (v) out[m[1].trim().toLowerCase()] = v;
  }
  return out;
}

/** Raison d'une fermeture, d'après le texte libre des sauveteurs. */
export function closureReason(text: string): string | null {
  const t = text.toLowerCase();
  if (/shark/.test(t)) return "Shark sighting";
  if (/pollut|sewage|stormwater|water quality|contamin/.test(t)) return "Water pollution";
  if (/lightning|thunder|storm/.test(t)) return "Storm and lightning";
  if (/bluebottle|jellyfish|stinger/.test(t)) return "Bluebottles";
  if (/swell|surf|rip|dangerous|rough|large|big|heavy|conditions/.test(t)) return "Dangerous surf";
  const due = text.match(/due to ([^.]+)/i)?.[1];
  return due ? due.charAt(0).toUpperCase() + due.slice(1) : null;
}

export function parseLifeguards(xml: string, now = new Date()): Pick<BeachStatus, "status" | "reason" | "lifeguard"> | null {
  const item = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]).find((it) => /maroubra/i.test(decode(tag(it, "title") ?? "")));
  if (!item) return null;
  const f = reportFields(tag(item, "description") ?? "");
  const at = new Date(decode(tag(item, "pubDate") ?? ""));
  const valid = Number.isFinite(at.getTime());
  const today = valid && sydneyDay(at) === sydneyDay(now);
  const raw = (f["beach status"] ?? "").toLowerCase();
  const said = /closed/.test(raw) ? "closed" : /open/.test(raw) ? "open" : /closed/i.test(f.summary ?? "") ? "closed" : null;
  const photo = decode(tag(item, "img") ?? "");
  return {
    status: today && said ? said : "unknown",
    reason: said === "closed" ? closureReason(`${f.summary ?? ""}. ${f.description ?? ""}`) : null,
    lifeguard: {
      summary: f.summary ?? null, description: f.description ?? null, rips: f.rips ?? null, bluebottles: f.bluebottles ?? null,
      waterTemp: f["water temp"] ?? null, waveHeight: f["wave height"] ?? null,
      at: valid ? at.toISOString() : now.toISOString(), today,
      // Seules les images de la mairie sont acceptées (la politique de sécurité du site n'autorise que cet hôte).
      photo: /^https:\/\/www\.randwick\.nsw\.gov\.au\/[^\s"'<>]+$/.test(photo) ? photo : null,
    },
  };
}

type Geo = { features?: { properties?: Record<string, unknown> }[] };
export function parseBeachwatch(j: Geo): BeachStatus["water"] {
  const f = (j.features ?? []).map((x) => x.properties ?? {}).find((p) => String(p.siteName ?? "").toLowerCase() === "maroubra beach");
  if (!f) return null;
  const fc = String(f.pollutionForecast ?? "");
  return {
    forecast: (["Unlikely", "Possible", "Likely"] as const).find((k) => k.toLowerCase() === fc.toLowerCase()) ?? null,
    latest: f.latestResult ? String(f.latestResult) : null,
    at: f.pollutionForecastTimeStamp ? String(f.pollutionForecastTimeStamp) : null,
  };
}

export function parseBeachsafe(j: { beach?: Record<string, unknown> }): Pick<BeachStatus, "patrol" | "hazard"> {
  const b = j.beach ?? (j as Record<string, unknown>);
  const p = b.is_patrolled_today as { flag?: boolean; start?: string; end?: string } | undefined;
  const hz = Number(b.hazard);
  return {
    patrol: p ? { today: Boolean(p.flag), start: p.start || null, end: p.end || null } : null,
    hazard: Number.isFinite(hz) && hz >= 1 && hz <= 10 ? hz : null,
  };
}

export const beachStatus: Collector<BeachStatus> = {
  id: "beachStatus",
  everyMs: 15 * 60e3,
  staleAfterMs: 6 * 3600e3,
  run: async ({ now }) => {
    const [lg, bw, bs] = await Promise.allSettled([
      fetchText(LIFEGUARD_FEED, { headers: { "User-Agent": BROWSER_UA, Accept: "application/rss+xml, application/xml, text/xml" } }).then((x) => parseLifeguards(x, now)),
      fetchJson<Geo>(BEACHWATCH).then(parseBeachwatch),
      fetchJson<{ beach?: Record<string, unknown> }>(BEACHSAFE, { headers: { "User-Agent": BROWSER_UA, Referer: "https://beachsafe.org.au/" } }).then(parseBeachsafe),
    ]);
    const errors = [lg, bw, bs].flatMap((r, i) => (r.status === "rejected" ? [`${["Lifeguard report", "Beachwatch", "Beachsafe"][i]}: ${String((r.reason as Error)?.message ?? r.reason)}`] : []));
    if (errors.length === 3) throw new Error(errors.join("; "));
    const l = lg.status === "fulfilled" ? lg.value : null;
    const s = bs.status === "fulfilled" ? bs.value : { patrol: null, hazard: null };
    return {
      status: l?.status ?? "unknown", reason: l?.reason ?? null, lifeguard: l?.lifeguard ?? null,
      patrol: s.patrol, hazard: s.hazard, water: bw.status === "fulfilled" ? bw.value : null, errors,
    };
  },
};
