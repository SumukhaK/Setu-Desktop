import { StatusStrip } from "./daemon/StatusStrip";
import type { DaemonPort } from "./daemon/status";
import type { SessionHubPort } from "./state/useSessions";

export function App({ port, hubPort }: { port: DaemonPort; hubPort: SessionHubPort }) {
  void hubPort;
  return (
    <main className="app">
      <header className="app-header">
        <h1>Setu</h1>
      </header>
      <StatusStrip port={port} />
    </main>
  );
}
