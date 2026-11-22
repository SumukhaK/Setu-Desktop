import { useState } from "react";

import { StatusStrip } from "./daemon/StatusStrip";
import type { DaemonPort } from "./daemon/status";
import { PairDialog } from "./features/pair/PairDialog";
import type { PairPort } from "./features/pair/pairPort";
import { systemClock } from "./state/clock";
import { useSessions } from "./state/useSessions";
import type { SessionHubPort } from "./state/useSessions";

export function App({
  port,
  hubPort,
  pairPort,
}: {
  port: DaemonPort;
  hubPort: SessionHubPort;
  pairPort?: PairPort;
}) {
  const sessions = useSessions(hubPort, systemClock);
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
