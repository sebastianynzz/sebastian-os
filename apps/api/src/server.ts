import "dotenv/config";
import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp();

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => {
    console.log(`MoveOS API escuchando en :${config.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
