import "dotenv/config";
// Sentry debe inicializarse antes de construir la app (P0.7).
import "./lib/sentry.js";
import { buildApp } from "./app.js";
import { captureError } from "./lib/sentry.js";
import { config } from "./config.js";

const app = await buildApp();

// Manejadores a nivel de proceso (P0.7): sin esto, una sola promesa rechazada
// en trabajo de fondo (push, webhooks, SSE, pool de Prisma) tumba TODA la API
// y Render la reinicia sin dejar rastro en el log de peticiones — justo el
// síntoma de "el servidor falló" sin error visible. Aquí lo registramos y lo
// mandamos a Sentry para que el siguiente fallo sea diagnosticable.

// Promesa rechazada sin manejar: registrar y SEGUIR vivos. Una tarea de fondo
// suelta no debe derribar el servidor entero.
process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason }, "unhandledRejection (no derriba el proceso)");
  captureError(reason);
});

// Excepción no capturada: el estado del proceso queda indeterminado. Lo
// correcto es registrar, cerrar ordenadamente y dejar que Render levante una
// instancia limpia (en vez del crash silencioso por defecto de Node).
process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "uncaughtException: cerrando para reinicio limpio");
  captureError(err);
  app
    .close()
    .catch(() => {})
    .finally(() => process.exit(1));
});

// Apagado ordenado ante SIGTERM (Render lo envía en cada redeploy): cierra
// streams SSE y conexiones antes de salir para no dejar peticiones colgadas.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} recibido: apagando MoveOS API`);
    app
      .close()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => {
    console.log(`MoveOS API escuchando en :${config.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
