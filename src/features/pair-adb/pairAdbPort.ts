export type PairAdbOutcome =
  | { outcome: "paired"; transport: string }
  | { outcome: "malformed" }
  | { outcome: "invalid_device" }
  | { outcome: "not_ready" }
  | { outcome: "already_pending" }
  | { outcome: "pair_failed" }
  | { outcome: "unsupported" }
  | { outcome: "not_paired" }
  | { outcome: "unavailable" }
  | { outcome: "cancelled" }
  | { outcome: "failed"; code: number | null };

export interface PairAdbPort {
  pair(deviceId: string, code: string, port: number | null): Promise<PairAdbOutcome>;
  cancel(): Promise<boolean>;
}

export function parseAdbPairInput(
  code: string,
  port: string,
): { code: string; port: number | null } | null {
  const compact = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(compact)) {
    return null;
  }
  const trimmedPort = port.trim();
  if (trimmedPort === "") {
    return { code: compact, port: null };
  }
  if (!/^\d+$/.test(trimmedPort)) {
    return null;
  }
  const number = Number(trimmedPort);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    return null;
  }
  return { code: compact, port: number };
}

export function pairAdbMessage(outcome: PairAdbOutcome): string | null {
  switch (outcome.outcome) {
    case "paired":
    case "cancelled":
      return null;
    case "malformed":
      return "Enter the 6-digit code and, if one is shown, a port from 1 to 65535.";
    case "pair_failed":
      return "Pairing didn't work. Get a new code on the phone and try again.";
    case "unsupported":
      return "Update Setu on the phone to use this.";
    case "not_paired":
      return "This device isn't paired any more. Pair it again with a new code.";
    case "unavailable":
      return "The phone is offline or can't be reached. Check that Setu is hosting on it.";
    case "already_pending":
      return "Another connection is already in progress.";
    case "not_ready":
      return "The Setu service isn't ready yet. Try again in a moment.";
    case "invalid_device":
      return "Couldn't pair. Try again.";
    case "failed":
      return outcome.code === null
        ? "Couldn't pair. Try again."
        : `Couldn't pair (error ${String(outcome.code)}). Try again.`;
  }
}
