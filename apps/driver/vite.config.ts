import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Emite dist/sw.js desde src/sw.template.js con la versión de caché ligada
 * al build (P0.2 auto-update: cada release invalida el shell cacheado y
 * llega al conductor en la siguiente carga). En dev no hay SW: Vite sirve
 * en caliente y la cola offline de la app no lo necesita.
 */
function serviceWorker(): Plugin {
  return {
    name: "moveos-service-worker",
    apply: "build",
    closeBundle() {
      const template = readFileSync(
        fileURLToPath(new URL("./src/sw.template.js", import.meta.url)),
        "utf8",
      );
      writeFileSync(
        fileURLToPath(new URL("./dist/sw.js", import.meta.url)),
        template.replaceAll("__CACHE_VERSION__", `v${Date.now()}`),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
});
