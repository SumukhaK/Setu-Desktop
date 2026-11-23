import type { DaemonPort } from "./status";
import { statusLabel, useDaemonStatus } from "./status";

export function StatusStrip({ port }: { port: DaemonPort }) {
  const status = useDaemonStatus(port);

  return (
    <div className="notice" role="status" aria-live="polite">
      {status === null ? "Checking…" : statusLabel(status)}
    </div>
  );
}
