import { useState } from "react";

import { DevicesPage } from "./app/DevicesPage";
import { Shell } from "./app/Shell";
import type { Page } from "./app/Shell";
import { WorkspacePage } from "./app/WorkspacePage";
import type { DaemonPort } from "./daemon/status";
import type { AdbPort } from "./features/adb/adbStatus";
import { useAdbStatus } from "./features/adb/useAdbStatus";
import type { DevicesPort } from "./features/devices/devicesPort";
import type { PairPort } from "./features/pair/pairPort";
import type { SessionPort } from "./features/session/sessionPort";
import { systemClock } from "./state/clock";
import type { Clock } from "./state/clock";
import { useSessions } from "./state/useSessions";
import type { SessionHubPort } from "./state/useSessions";

const noSessionPort: SessionPort = {
  stop: () => Promise.resolve({ outcome: "not_ready" }),
};
const noClipboard = { writeText: () => Promise.resolve() };

export function App({
  port,
  hubPort,
  pairPort,
  adbPort,
  sessionPort,
  clipboard,
  clock = systemClock,
  devicesPort,
}: {
  port: DaemonPort;
  hubPort: SessionHubPort;
  pairPort?: PairPort;
  adbPort?: AdbPort;
  sessionPort?: SessionPort;
  clipboard?: { writeText(s: string): Promise<void> };
  clock?: Clock;
  devicesPort?: DevicesPort;
}) {
  const stopPort = sessionPort ?? noSessionPort;
  const targetClipboard = clipboard ?? noClipboard;
  const sessions = useSessions(hubPort, clock);
  const adb = useAdbStatus(adbPort ?? null);
  const [pairing, setPairing] = useState(false);
  const [page, setPage] = useState<Page>("workspace");
  const [dismissedEnded, setDismissedEnded] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const live = Object.values(sessions.live);
  const endedNotices = sessions.ended.filter(
    (session) =>
      session.reason !== "closed" &&
      !dismissedEnded.has(session.sessionId) &&
      (session.deviceId === null || !live.some((active) => active.deviceId === session.deviceId)),
  );

  return (
    <Shell
      page={page}
      onNavigate={setPage}
      items={devicesPort === undefined ? ["workspace"] : ["workspace", "devices"]}
    >
      {page === "workspace" ? (
        <WorkspacePage
          port={port}
          sessions={live}
          adb={adb}
          clock={clock}
          adbPort={adbPort ?? null}
          sessionPort={stopPort}
          clipboard={targetClipboard}
          pairPort={pairPort}
          pairing={pairing}
          onPair={() => {
            setPairing(true);
          }}
          onPairingClose={() => {
            setPairing(false);
          }}
          ended={endedNotices}
          onDismissEnded={(sessionId) => {
            setDismissedEnded((current) => new Set(current).add(sessionId));
          }}
          reconnect={devicesPort === undefined ? undefined : devicesPort.connect.bind(devicesPort)}
        />
      ) : devicesPort !== undefined ? (
        <DevicesPage port={devicesPort} liveDeviceIds={live.map((session) => session.deviceId)} />
      ) : null}
    </Shell>
  );
}
