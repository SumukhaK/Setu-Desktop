export type StopOutcome =
  | { outcome: "stopped" }
  | { outcome: "no_session" }
  | { outcome: "not_ready" }
  | { outcome: "invalid" }
  | { outcome: "failed"; code: number | null };

export interface SessionPort {
  stop(sessionId: string): Promise<StopOutcome>;
}

export function stopMessage(outcome: StopOutcome): string | null {
  switch (outcome.outcome) {
    case "stopped":
    case "no_session":
      return null;
    case "not_ready":
      return "The Setu service isn't ready yet. Try again in a moment.";
    case "invalid":
      return "This session can't be stopped from here.";
    case "failed":
      return outcome.code === null
        ? "Couldn't disconnect. Try again."
        : `Couldn't disconnect (error ${String(outcome.code)}). Try again.`;
  }
}
