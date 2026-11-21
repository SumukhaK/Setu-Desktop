import { StatusStrip } from "./daemon/StatusStrip";
import type { DaemonPort } from "./daemon/status";
import { systemClock } from "./state/clock";
import { useSessions } from "./state/useSessions";
import type { SessionHubPort } from "./state/useSessions";

export function App({ port, hubPort }: { port: DaemonPort; hubPort: SessionHubPort }) {
  const sessions = useSessions(hubPort, systemClock);
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
    </main>
  );
}
