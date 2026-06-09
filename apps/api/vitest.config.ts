import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Las pruebas comparten una base de datos: ejecutar en serie.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
