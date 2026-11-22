export type StopOutcome =
  | { outcome: "stopped" }
  | { outcome: "no_session" }
  | { outcome: "not_ready" }
  | { outcome: "invalid" }
  | { outcome: "failed"; code: number | null };

export interface SessionPort {
  stop(sessionId: string): Promise<StopOutcome>;
}

export function stopMessage(_outcome: StopOutcome): string | null {
  return null;
}
