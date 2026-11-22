import { useState } from "react";

import { StatusStrip } from "./daemon/StatusStrip";
import type { DaemonPort } from "./daemon/status";
import type { AdbPort } from "./features/adb/adbStatus";
import { useAdbStatus } from "./features/adb/useAdbStatus";
import { PairDialog } from "./features/pair/PairDialog";
import { SessionCard } from "./features/session/SessionCard";
import type { SessionPort } from "./features/session/sessionPort";
import type { PairPort } from "./features/pair/pairPort";
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
}: {
  port: DaemonPort;
  hubPort: SessionHubPort;
  pairPort?: PairPort;
  adbPort?: AdbPort;
  sessionPort?: SessionPort;
  clipboard?: { writeText(s: string): Promise<void> };
  clock?: Clock;
}) {
  const stopPort = sessionPort ?? noSessionPort;
  const targetClipboard = clipboard ?? noClipboard;
  const sessions = useSessions(hubPort, clock);
  const adb = useAdbStatus(adbPort ?? null);
  const [pairing, setPairing] = useState(false);
  const count = Object.keys(sessions.live).length;
  const line =
    count === 0 ? "No live sessions" : `${String(count)} live session${count === 1 ? "" : "s"}`;

  return (
    <main className="app">
      <header className="app-header">
        <h1>Setu</h1>
      </header>
      <StatusStrip port={port} />
      <p>{line}</p>
      {Object.values(sessions.live).map((session) => (
        <SessionCard
          key={session.sessionId}
          session={session}
          adb={adb}
          clock={clock}
          adbPort={adbPort ?? null}
          sessionPort={stopPort}
          clipboard={targetClipboard}
        />
      ))}
      {pairPort !== undefined && (
        <>
          <button
            type="button"
            onClick={() => {
              setPairing(true);
            }}
          >
            Pair new device
          </button>
          {pairing && (
            <PairDialog
              port={pairPort}
              onClose={() => {
                setPairing(false);
              }}
            />
          )}
        </>
      )}
    </main>
  );
}
