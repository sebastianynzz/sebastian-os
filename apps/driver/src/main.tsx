import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerServiceWorker } from "./sw";
import "./styles.css";

// Auto-update + offline (P0.2/D2): el SW versiona el shell por release y
// cachea los tiles de la ruta; cada deploy llega en la siguiente carga.
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
