import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { DaemonPort, DaemonStatus } from "../daemon/status";
import type { AdbConnectOutcome, AdbPort, AdbSnapshot } from "../features/adb/adbStatus";
import type { ConnectOutcome, PairPort } from "../features/pair/pairPort";
import type { SessionPort, StopOutcome } from "../features/session/sessionPort";
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
  connect(code) {
    return invoke<ConnectOutcome>("session_connect_code", { code });
  },
  cancel() {
    return invoke<boolean>("session_cancel_connect");
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

export const tauriSessionPort: SessionPort = {
  stop(sessionId) {
    return invoke<StopOutcome>("session_stop", { sessionId });
  },
};

export const tauriAdbPort: AdbPort = {
  current() {
    return invoke<AdbSnapshot>("adb_status");
  },
  subscribe(onSnapshot) {
    return listen<AdbSnapshot>("adb-status", (event) => {
      onSnapshot(event.payload);
    });
  },
  connect(adbAddr) {
    return invoke<AdbConnectOutcome>("adb_connect", { adbAddr });
  },
};
