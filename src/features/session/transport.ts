import type { LiveSession } from "../../state/sessionStore";

export type TransportSource = "path" | "audit" | "unknown";

export function transportOf(_session: LiveSession): {
  transport: string | null;
  source: TransportSource;
} {
  return { transport: null, source: "unknown" };
}

export function transportLabel(_transport: string | null): string {
  return "Path unknown";
}
