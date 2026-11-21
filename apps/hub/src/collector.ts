// Ordonnanceur des collecteurs : chaque source a sa cadence, un délai de reprise après panne
// et un seuil de péremption. Une source en panne n'arrête jamais les autres.
import type { Store } from "./store";

/**
 * Un calcul dérivé dont une entrée n'est pas encore arrivée (juste après un démarrage) : ce n'est pas une panne.
 * Pas d'erreur affichée, nouvel essai 15 s plus tard au lieu de la reprise progressive.
 */
export class Waiting extends Error {
  constructor(what: string) { super(`waiting for ${what}`); }
}
const WAITING_RETRY_MS = 15_000;

export interface Collector<T = unknown> {
  id: string;
  everyMs: number;
  staleAfterMs: number;
  run: (ctx: { store: Store; now: Date }) => Promise<T>;
}

export function startCollectors(store: Store, collectors: Collector[], opts: { offline?: boolean } = {}) {
  const timers: NodeJS.Timeout[] = [];
  for (const col of collectors) store.register(col.id, col.staleAfterMs);
  if (opts.offline) return () => {};
  for (const [i, col] of collectors.entries()) {
    let failures = 0;
    const tick = async () => {
      try {
        const data = await col.run({ store, now: new Date() });
        store.success(col.id, data);
        failures = 0;
      } catch (err) {
        if (err instanceof Waiting) {
          timers.push(setTimeout(tick, Math.min(col.everyMs, WAITING_RETRY_MS)));
          return;
        }
        failures++;
        store.failure(col.id, err);
        console.error(JSON.stringify({ event: "collector_failed", source: col.id, error: String((err as Error)?.message ?? err) }));
      }
      // Reprise progressive : 1, 2, 4… fois la cadence, au plus 30 min.
      const delay = Math.min(col.everyMs * 2 ** Math.min(failures, 5), Math.max(col.everyMs, 30 * 60e3));
      timers.push(setTimeout(tick, delay + Math.random() * Math.min(5_000, col.everyMs / 10)));
    };
    timers.push(setTimeout(tick, 250 * i));
  }
  return () => timers.forEach(clearTimeout);
}
