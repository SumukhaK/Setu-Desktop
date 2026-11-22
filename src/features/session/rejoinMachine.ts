import type { LiveSession } from "../../state/sessionStore";

export const HOLD_AFTER_MS = 10_000;

export type RejoinView =
  { kind: "none" } | { kind: "holding" } | { kind: "lost"; tunnelId: string };

export function rejoinViewOf(
  _session: LiveSession,
  _now: number,
  _dismissed: ReadonlySet<string>,
): RejoinView {
  return { kind: "none" };
}

export function nextWakeAt(_session: LiveSession, _now: number): number | null {
  return null;
}
