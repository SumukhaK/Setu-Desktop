import type { LiveSession } from "../../state/sessionStore";

export const HOLD_AFTER_MS = 10_000;

export type RejoinView =
  { kind: "none" } | { kind: "holding" } | { kind: "lost"; tunnelId: string };

export function rejoinViewOf(
  session: LiveSession,
  now: number,
  dismissed: ReadonlySet<string>,
): RejoinView {
  let latestLost: { tunnelId: string; at: number } | null = null;
  let latestUpAt: number | null = null;
  let holding = false;

  for (const [tunnelId, tunnel] of Object.entries(session.tunnels)) {
    if (tunnel.state === "lost") {
      if (!dismissed.has(tunnelId) && (latestLost === null || tunnel.at > latestLost.at)) {
        latestLost = { tunnelId, at: tunnel.at };
      }
    } else if (tunnel.state === "up") {
      if (latestUpAt === null || tunnel.at > latestUpAt) {
        latestUpAt = tunnel.at;
      }
    } else if (now - tunnel.since >= HOLD_AFTER_MS) {
      holding = true;
    }
  }

  if (latestLost !== null && (latestUpAt === null || latestLost.at > latestUpAt)) {
    return { kind: "lost", tunnelId: latestLost.tunnelId };
  }
  return holding ? { kind: "holding" } : { kind: "none" };
}

export function nextWakeAt(session: LiveSession, now: number): number | null {
  let next: number | null = null;
  for (const tunnel of Object.values(session.tunnels)) {
    if (tunnel.state === "down") {
      const wake = tunnel.since + HOLD_AFTER_MS;
      if (wake > now && (next === null || wake < next)) {
        next = wake;
      }
    }
  }
  return next;
}
