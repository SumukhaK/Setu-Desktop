import type { DaemonPort } from "./status";

export function StatusStrip({ port }: { port: DaemonPort }) {
  void port;
  return <div role="status" />;
}
