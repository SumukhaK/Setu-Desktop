import type { LiveSession } from "../../state/sessionStore";

export type TransportSource = "path" | "audit" | "unknown";

export function transportOf(session: LiveSession): {
  transport: string | null;
  source: TransportSource;
} {
  if (session.transport !== null) {
    return { transport: session.transport, source: "path" };
  }
  if (session.auditTransport !== null) {
    return { transport: session.auditTransport, source: "audit" };
  }
  return { transport: null, source: "unknown" };
}

export function transportLabel(transport: string | null): string {
  switch (transport) {
    case "lan":
      return "LAN (direct)";
    case "relay-wss":
      return "Relay (WSS)";
    case "relay-ws":
      return "Relay (WS)";
    case "relay-tcp":
      return "Relay (TCP)";
    case null:
      return "Path unknown";
    default:
      return transport;
  }
}
