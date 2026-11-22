import { useState } from "react";

import { StatusStrip } from "./daemon/StatusStrip";
import type { DaemonPort } from "./daemon/status";
import { SessionAdbLine } from "./features/adb/SessionAdbLine";
import type { AdbPort } from "./features/adb/adbStatus";
import { useAdbStatus } from "./features/adb/useAdbStatus";
import { PairDialog } from "./features/pair/PairDialog";
import type { PairPort } from "./features/pair/pairPort";
import { systemClock } from "./state/clock";
import { useSessions } from "./state/useSessions";
import type { SessionHubPort } from "./state/useSessions";

export function App({
  port,
  hubPort,
  pairPort,
  adbPort,
}: {
  port: DaemonPort;
  hubPort: SessionHubPort;
  pairPort?: PairPort;
  adbPort?: AdbPort;
}) {
  const sessions = useSessions(hubPort, systemClock);
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
        <SessionAdbLine
          key={session.sessionId}
          session={session}
          adb={adb}
          port={adbPort ?? null}
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
