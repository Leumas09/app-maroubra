// Surfeurs à l'eau, lus sur les deux caméras de la mairie par le modèle de vision (docs/PLAN.md, partie U).
// Demande de Samuel : le matin, avant le rapport des sauveteurs, savoir s'il y a déjà des surfeurs.
// Le coût est borné par construction : seulement du premier jour à 9 h (heure de Sydney), une lecture
// toutes les 30 min au plus, et un plafond de lectures par jour. Chaque lecture compte, réussie ou non.
import type { SurfCrowd, SurfWatch } from "@maroubra/core";
import { astronomy as A, horizontal } from "@maroubra/sky";
import type { Collector } from "../collector";
import type { Llm, Usage } from "../llm";

export const SURF_CAMS = [
  { id: "north", name: "North end of Maroubra Beach", path: "maroubra_north" },
  { id: "south", name: "South end of Maroubra Beach", path: "maroubra_south" },
] as const;
type CamId = (typeof SURF_CAMS)[number]["id"];

/** Plafond de lectures par jour : au prix public relevé le 24/11/2026, environ 0,02 USD par lecture au pire. */
export const LOOKS_PER_DAY = 10;
export const LOOK_EVERY_MS = 30 * 60e3;
/** La fenêtre s'ouvre quand le Soleil est à moins de 3° sous l'horizon (image déjà lisible) et ferme à 9 h. */
const SUN_MIN_ALT = -3;
const CLOSE_HOUR = 9;
/** Une image plus vieille que cela vient d'une caméra arrêtée : on ne paie pas pour la lire. */
const IMAGE_MAX_AGE_MS = 10 * 60e3;

const sydneyDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(d);
const sydneyHour = (d: Date) => Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(d));

/** Matin, de la première lumière à 9 h. */
export function inMorningWindow(now: Date, sunAlt = horizontal(A.Body.Sun, now).alt): boolean {
  return sydneyHour(now) < CLOSE_HOUR && sunAlt >= SUN_MIN_ALT;
}

export interface LookState { day: string; looks: number; lastLookMs: number | null }

/** Faut-il lire les images maintenant ? Fenêtre du matin, cadence et plafond du jour. */
export function shouldLook(state: LookState, now: Date, sunAlt?: number): boolean {
  if (!inMorningWindow(now, sunAlt)) return false;
  const looks = state.day === sydneyDay(now) ? state.looks : 0;
  if (looks >= LOOKS_PER_DAY) return false;
  return state.lastLookMs == null || now.getTime() - state.lastLookMs >= LOOK_EVERY_MS;
}

const RANK: Record<SurfCrowd, number> = { unclear: -1, none: 0, few: 1, many: 2 };
/** Le plus fort des deux bouts de plage ; « unclear » seulement si aucune caméra n'est lisible. */
export const overall = (cams: { crowd: SurfCrowd }[]): SurfCrowd => cams.reduce<SurfCrowd>((m, c) => (RANK[c.crowd] > RANK[m] ? c.crowd : m), "unclear");

export const INSTRUCTIONS =
  "You look at still images from the two council cameras at Maroubra Beach, Sydney, taken a moment ago. " +
  "For each image, say whether surfers are in the water: people sitting or lying on boards beyond the breaking waves, paddling, or riding a wave (surfboards and bodyboards). " +
  "Do not count people on the sand, walkers, swimmers without a board, rocks, buoys, birds or white water. Surfers are small: dark dots or short dark strokes on the water, often in a loose group. " +
  "Answer per image with crowd: \"none\" if you see no surfer, \"few\" for 1 to 5, \"many\" for 6 or more, \"unclear\" if the sea cannot be read (too dark, rain or spray on the lens, fog, glare, camera pointing elsewhere). " +
  "Prefer \"unclear\" to a guess. Add a note of at most 12 words saying what you see and where (for example \"about four sitting off the north rocks\"). Answer with JSON only.";

const camSchema = {
  type: "object", additionalProperties: false, required: ["crowd", "note"],
  properties: { crowd: { type: "string", enum: ["none", "few", "many", "unclear"] }, note: { type: "string" } },
};
export const FORMAT = {
  name: "surfers",
  schema: { type: "object", additionalProperties: false, required: ["north", "south"], properties: { north: camSchema, south: camSchema } },
};

const CROWDS = new Set<string>(["none", "few", "many", "unclear"]);
/** Réponse du modèle ramenée à ce qu'on affiche ; une caméra non envoyée ou mal décrite reste « unclear ». */
export function readAnswer(json: unknown, sent: CamId[]): SurfWatch["cams"] {
  const j = (json ?? {}) as Record<string, { crowd?: unknown; note?: unknown } | undefined>;
  return SURF_CAMS.map(({ id }) => {
    const a = j[id];
    if (!sent.includes(id)) return { id, crowd: "unclear" as const, note: "Camera image unavailable" };
    const crowd = typeof a?.crowd === "string" && CROWDS.has(a.crowd) ? (a.crowd as SurfCrowd) : "unclear";
    return { id, crowd, note: typeof a?.note === "string" ? a.note.trim().slice(0, 120) : "" };
  });
}

export interface CamImage { id: CamId; jpeg: Uint8Array }
export type FetchCam = (path: string, now: Date) => Promise<Uint8Array | null>;

/** Image en direct d'une caméra ; null si elle ne répond pas ou si l'image est trop vieille. */
export const fetchCam: FetchCam = async (path, now) => {
  const res = await fetch(`https://randwickcc-thumb.secdn.net/randwickcc-channel/play/${path}/thumbnail.jpg`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
  const modified = Date.parse(res.headers.get("last-modified") ?? "");
  if (Number.isFinite(modified) && now.getTime() - modified > IMAGE_MAX_AGE_MS) return null;
  return new Uint8Array(await res.arrayBuffer());
};

export interface SurfLook { at: string; cams: SurfWatch["cams"]; images: CamImage[]; usage: Usage }

/**
 * Collecteur : passe toutes les 5 minutes, mais n'appelle le modèle que si `shouldLook` le permet.
 * Sans modèle configuré (en local, en démonstration), il ne fait rien.
 */
export function surfWatchCollector(llm: Pick<Llm, "look"> | null, opts: { fetchCam?: FetchCam; onLook?: (l: SurfLook) => void } = {}): Collector<SurfWatch> {
  const get = opts.fetchCam ?? fetchCam;
  const state: LookState = { day: "", looks: 0, lastLookMs: null };
  let tokens = { inputTokens: 0, outputTokens: 0 };
  let last: Pick<SurfWatch, "at" | "crowd" | "cams"> = { at: null, crowd: "unclear", cams: [] };
  const snapshot = (): SurfWatch => ({ ...last, budget: { day: state.day, looks: state.looks, cap: LOOKS_PER_DAY, ...tokens } });
  return {
    id: "surf",
    everyMs: 5 * 60e3,
    staleAfterMs: 20 * 60e3,
    run: async ({ now }) => {
      const day = sydneyDay(now);
      if (state.day !== day) { state.day = day; state.looks = 0; tokens = { inputTokens: 0, outputTokens: 0 }; }
      if (!llm || !shouldLook(state, now)) return snapshot();
      const images: CamImage[] = [];
      for (const cam of SURF_CAMS) {
        const jpeg = await get(cam.path, now);
        if (jpeg) images.push({ id: cam.id, jpeg });
      }
      state.lastLookMs = now.getTime();
      // Aucune image fraîche : rien à lire, donc rien à payer ; nouvel essai à la cadence suivante.
      if (!images.length) return snapshot();
      state.looks++;
      const add = (u?: Usage) => { tokens = { inputTokens: tokens.inputTokens + (u?.inputTokens ?? 0), outputTokens: tokens.outputTokens + (u?.outputTokens ?? 0) }; };
      try {
        const { json, usage } = await llm.look(INSTRUCTIONS, images.map((im) => ({ label: `Image "${im.id}": ${SURF_CAMS.find((c) => c.id === im.id)!.name}.`, jpeg: im.jpeg })), FORMAT);
        add(usage);
        const cams = readAnswer(json, images.map((im) => im.id));
        last = { at: now.toISOString(), crowd: overall(cams), cams };
        console.log(JSON.stringify({ event: "surf_look", crowd: last.crowd, cams: cams.map((c) => `${c.id}:${c.crowd}`).join(","), looks: state.looks, ...usage }));
        opts.onLook?.({ at: last.at!, cams, images, usage });
      } catch (err) {
        add((err as { usage?: Usage }).usage);
        throw err;
      }
      return snapshot();
    },
  };
}
