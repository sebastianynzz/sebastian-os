import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { PruneOptions, RETENTION_DAYS, pruneTelemetry } from "../services/routeTrack.js";

/**
 * Job de retención de telemetría. Construye las trazas de las rutas
 * completadas y poda los pings crudos anteriores a la ventana de retención.
 *
 * Corre como servicio `cron` de Render (ver render.yaml), NO dentro de la API:
 * un temporizador en proceso se dispararía también en las ~46 pruebas de
 * integración, que comparten una sola base de datos en serie, y borraría filas
 * de otras pruebas.
 *
 * Uso:  pnpm --filter @moveos/api retention [--dry-run] [--days=90]
 * (el script NO puede llamarse `prune`: colisiona con el comando de pnpm)
 * Sale con código 1 si falla, para que Render marque la ejecución en rojo.
 */

function parseArgs(argv: string[]): PruneOptions {
  const opts: PruneOptions = {};
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    const days = /^--days=(\d+)$/.exec(arg);
    if (days) opts.retentionDays = Number(days[1]);
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const retentionDays = opts.retentionDays ?? RETENTION_DAYS;
  const startedAt = Date.now();

  const results = await pruneTelemetry(opts);

  // Una línea JSON por tenant con actividad + un resumen: este log ES el
  // historial de ejecuciones (no hay tabla de jobs).
  for (const r of results) {
    console.log(JSON.stringify({ job: "retention", ...r }));
  }
  console.log(
    JSON.stringify({
      job: "retention",
      summary: true,
      dryRun: opts.dryRun ?? false,
      retentionDays,
      tenantsAffected: results.length,
      tracksBuilt: results.reduce((n, r) => n + r.tracksBuilt, 0),
      pingsDeleted: results.reduce((n, r) => n + r.pingsDeleted, 0),
      durationMs: Date.now() - startedAt,
    }),
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
