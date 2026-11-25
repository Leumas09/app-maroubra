// Relevé horaire du Track record (option B choisie par Samuel le 26/11/2026).
// L'app s'endort quelques minutes après la dernière visite (infra/project.bicep) : elle ne relève plus rien
// pendant son sommeil. Une tâche planifiée Container Apps (même image, commande `node job.mjs`) la remplace
// chaque heure : elle interroge une fois les sources que l'archive horaire enregistre, écrit l'heure
// (hourRows : prévisions émises, observations de YSSY et de la bouée, score du lever), puis s'arrête.
// Aucun appel au modèle, aucune notification. Ce qui demande un suivi continu (survols annoncés et jugés,
// ciel satellite au lever) n'est enregistré que pendant que l'app est éveillée.
import { archiveHour, tableArchive, type ArchiveTable } from "./archive";
import type { Collector } from "./collector";
import { loadConfig } from "./config";
import { sunrise } from "./derive/sunrise";
import { buoy, buoyForecast, marine } from "./sources/sea";
import { airportForecast, metar, weather } from "./sources/weather";
import { Store } from "./store";
import { table } from "./tables";

/** Les sources lues par hourRows (src/archive.ts), et elles seules. */
export const ARCHIVE_SOURCES: Collector[] = [weather, airportForecast, marine, buoyForecast, metar, buoy, sunrise];

export interface ArchiveRun { rows: number; ok: string[]; failed: { id: string; error: string }[] }

/** Une passe : toutes les sources en parallèle, puis l'heure écrite dans l'archive. */
export async function archiveOnce(archive: ArchiveTable, sources: Collector[] = ARCHIVE_SOURCES, now = new Date()): Promise<ArchiveRun> {
  const store = new Store();
  for (const c of sources) store.register(c.id, c.staleAfterMs);
  const results = await Promise.allSettled(sources.map(async (c) => store.success(c.id, await c.run({ store, now }), now)));
  const ok: string[] = [];
  const failed: ArchiveRun["failed"] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push(sources[i].id);
    else failed.push({ id: sources[i].id, error: String((r.reason as Error)?.message ?? r.reason) });
  });
  return { rows: await archiveHour(archive, store, now), ok, failed };
}

// Point d'entrée de la tâche planifiée : code de sortie non nul si rien n'a été écrit, pour que l'échec se voie.
if (process.argv[1]?.endsWith("job.mjs")) {
  const cfg = loadConfig();
  const client = table(cfg.tableEndpoint, "archive", cfg.managedIdentityClientId);
  if (!client) {
    console.error(JSON.stringify({ event: "job_failed", error: "TABLE_ENDPOINT manquant" }));
    process.exit(1);
  }
  const run = await archiveOnce(tableArchive(client));
  console.log(JSON.stringify({ event: "job_archived", rows: run.rows, ok: run.ok.join(","), failed: run.failed }));
  process.exit(run.rows > 0 ? 0 : 1);
}
