import { StatusStrip } from "./daemon/StatusStrip";
import type { DaemonPort } from "./daemon/status";

export function App({ port }: { port: DaemonPort }) {
  return (
    <main className="app">
      <header className="app-header">
        <h1>Setu</h1>
      </header>
      <StatusStrip port={port} />
    </main>
  );
}
