// Nuit de l'app (demande de Samuel du 25/11/2026) : de 22 h 30 à 6 h 30, heure de Sydney.
// Depuis le 26/11/2026, l'app dort dès que personne ne la regarde (infra/project.bicep) ; si on l'ouvre
// la nuit, elle se réveille mais n'appelle aucun modèle : le brief passe aux règles et les actualités
// au filtre par mots-clés.

/** Début et fin de la nuit, en minutes depuis minuit à Sydney. */
export const NIGHT = { start: 22 * 60 + 30, end: 6 * 60 + 30 } as const;

export function sydneyMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export function isNight(now: Date): boolean {
  const m = sydneyMinutes(now);
  return m >= NIGHT.start || m < NIGHT.end;
}

/** Le modèle seulement de jour : null la nuit, ce qui fait prendre le chemin sans modèle. */
export const dayOnly = <T>(llm: T | null, now: Date): T | null => (llm && !isNight(now) ? llm : null);
