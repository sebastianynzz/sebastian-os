import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdateToast } from "./components/UpdateToast";
import { OfflineQueue } from "./components/OfflineQueue";
import { registerServiceWorker } from "./sw";
import "./styles.css";

// Auto-update + offline (P0.2/D2): el SW versiona el shell por release y
// cachea los tiles de la ruta; cada deploy llega en la siguiente carga.
registerServiceWorker();

// Tema conductor: aplica la preferencia (default OSCURO, "dark-first") antes del
// render para evitar parpadeo claro→oscuro.
document.documentElement.classList.toggle(
  "dark",
  (localStorage.getItem("dalego-driver-theme") ??
    localStorage.getItem("moveos-driver-theme")) !== "light",
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary area="root">
      <App />
      <OfflineQueue />
      <UpdateToast />
    </ErrorBoundary>
  </StrictMode>,
);
