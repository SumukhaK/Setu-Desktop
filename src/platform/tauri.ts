import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { DaemonPort, DaemonStatus } from "../daemon/status";

export const tauriDaemonPort: DaemonPort = {
  current() {
    return invoke<DaemonStatus>("daemon_status");
  },
  subscribe(onStatus) {
    return listen<DaemonStatus>("daemon-status", (event) => {
      onStatus(event.payload);
    });
  },
};
