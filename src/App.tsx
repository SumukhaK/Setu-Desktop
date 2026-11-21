import type { DaemonPort } from "./daemon/status";
import type { PairPort } from "./features/pair/pairPort";
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
  void port;
  void hubPort;
  void pairPort;
  return (
    <main className="app">
      <h1>Setu</h1>
    </main>
  );
}
