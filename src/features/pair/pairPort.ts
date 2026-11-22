export type ConnectOutcome =
  | { outcome: "connected"; session_id: string; device_id: string; adb_addr: string }
  | { outcome: "malformed" }
  | { outcome: "not_ready" }
  | { outcome: "already_pending" }
  | { outcome: "bad_code" }
  | { outcome: "unavailable" }
  | { outcome: "not_paired" }
  | { outcome: "revoked" }
  | { outcome: "cancelled" }
  | { outcome: "failed"; code: number | null };

export interface PairPort {
  connect(code: string): Promise<ConnectOutcome>;
  cancel(): Promise<boolean>;
}

export function outcomeMessage(outcome: ConnectOutcome): string | null {
  switch (outcome.outcome) {
    case "connected":
    case "cancelled":
      return null;
    case "bad_code":
      return "That code didn't work. Check the 10 digits and that the phone is still hosting. After 3 wrong tries the phone shows a new code.";
    case "unavailable":
      return "The phone can't be reached right now. Make sure Setu is hosting on the phone, then try again.";
    case "not_paired":
    case "revoked":
      return null;
    case "not_ready":
      return "The Setu service isn't ready yet. Try again in a moment.";
    case "already_pending":
      return "A connection is already in progress.";
    case "malformed":
      return "Enter the 10 digits shown on the phone.";
    case "failed":
      return outcome.code === null
        ? "Couldn't connect. Try again."
        : `Couldn't connect (error ${String(outcome.code)}). Try again.`;
  }
}
