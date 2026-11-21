// Statut officiel de la plage (sauveteurs de Randwick, Beachsafe), partagé par la page Beach et l'accueil.
import type { BeachStatus, SourceEntry } from "@maroubra/core";

type E<T> = (SourceEntry<T> & { stale: boolean; ageMin: number | null }) | null;

const sydneyHour = (d: Date) => Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(d));
const hhmm = (s: string | null) => (s && /^\d{1,2}:\d{2}/.test(s) ? s.slice(0, 5) : s);

/** Drapeaux rouge et jaune des plages surveillées, ou drapeau rouge de fermeture. */
export function Flag({ kind, size = 44 }: { kind: "patrol" | "closed" | "unknown"; size?: number }) {
  if (kind === "unknown") return <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeDasharray="4 5" /></svg>;
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <line x1="9" y1="4" x2="9" y2="42" stroke="var(--ink-2)" strokeWidth="2.5" strokeLinecap="round" />
      {kind === "patrol" ? (
        <g><path d="M10 6 H38 V26 H10 Z" fill="oklch(82% 0.16 95)" /><path d="M10 6 H38 L10 26 Z" fill="oklch(58% 0.2 28)" /></g>
      ) : <path d="M10 6 H38 L33 16 L38 26 H10 Z" fill="oklch(55% 0.2 28)" />}
    </svg>
  );
}

/** Statut, titre (« Closed: shark sighting ») et horaires de surveillance du jour. */
export function officialStatus(e: E<BeachStatus>, now: Date): { status: BeachStatus["status"]; headline: string; patrol: string | null } {
  const s = e?.data;
  const lg = s?.lifeguard;
  const status = s?.status ?? "unknown";
  const early = sydneyHour(now) < 9;
  const headline = status === "closed" ? `Closed${s?.reason ? `: ${s.reason.toLowerCase()}` : ""}`
    : status === "open" ? "Open"
      : lg && !lg.today ? (early ? "Today's lifeguard report isn't out yet" : "No lifeguard report today")
        : e?.ok === false || !s ? "Official status unavailable" : "Status not published";
  const patrol = status !== "open" ? null
    : s?.patrol?.today && s.patrol.start ? `Patrolled today ${hhmm(s.patrol.start)} to ${hhmm(s.patrol.end)}, swim between the red and yellow flags`
      : s?.patrol?.today === false ? "Not patrolled today" : null;
  return { status, headline, patrol };
}

/** Bandeau compact pour l'accueil : drapeau, statut, et ce que disent les sauveteurs. */
export function BeachStatusLine({ e, now }: { e: E<BeachStatus>; now: Date }) {
  const { status, headline, patrol } = officialStatus(e, now);
  const lg = e?.data?.lifeguard;
  const detail = status === "closed" ? lg?.description ?? lg?.summary : patrol;
  return (
    <a className={`beach-line ${status}`} href="#beach" aria-label={`Maroubra Beach: ${headline}${detail ? `. ${detail}` : ""}. Open the Beach page.`}>
      <Flag kind={status === "closed" ? "closed" : status === "open" ? "patrol" : "unknown"} size={30} />
      <span className="beach-line-text">
        <span className="beach-line-k">Maroubra Beach</span>
        <strong>{headline}</strong>
        {detail && <span className="beach-line-sub">{detail.replace(/\.$/, "")}.</span>}
      </span>
    </a>
  );
}
