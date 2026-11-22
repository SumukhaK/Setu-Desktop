import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import {
  tauriAdbPort,
  tauriDaemonPort,
  tauriPairPort,
  tauriSessionHubPort,
  tauriSessionPort,
} from "./platform/tauri";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <App
      port={tauriDaemonPort}
      hubPort={tauriSessionHubPort}
      pairPort={tauriPairPort}
      adbPort={tauriAdbPort}
      sessionPort={tauriSessionPort}
      clipboard={navigator.clipboard}
    />
  </StrictMode>,
);
