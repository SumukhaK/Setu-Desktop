import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import {
  tauriAdbPort,
  tauriDaemonPort,
  tauriDevicesPort,
  tauriPairAdbPort,
  tauriPairPort,
  tauriSessionHubPort,
  tauriSessionPort,
  tauriWindowPort,
} from "./platform/tauri";
import "./styles/app.css";

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
      pairAdbPort={import.meta.env.VITE_SETU_ADB_PAIR === "1" ? tauriPairAdbPort : undefined}
      adbPort={tauriAdbPort}
      sessionPort={tauriSessionPort}
      clipboard={navigator.clipboard}
      devicesPort={tauriDevicesPort}
      windowPort={tauriWindowPort}
    />
  </StrictMode>,
);
