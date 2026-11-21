import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { DaemonPort, DaemonStatus } from "../daemon/status";
import type { PairPort } from "../features/pair/pairPort";
import type { HubMessage } from "../state/sessionStore";
import type { SessionHubPort } from "../state/useSessions";

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

export const tauriPairPort: PairPort = {
  connect() {
    return Promise.resolve({ outcome: "malformed" });
  },
  cancel() {
    return Promise.resolve(false);
  },
};

export const tauriSessionHubPort: SessionHubPort = {
  resync() {
    return invoke<undefined>("session_resync");
  },
  subscribe(onMessage) {
    return listen<HubMessage>("session-hub", (event) => {
      onMessage(event.payload);
    });
  },
};
