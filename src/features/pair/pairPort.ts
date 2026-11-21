export type ConnectOutcome =
  | { outcome: "connected"; session_id: string; device_id: string; adb_addr: string }
  | { outcome: "malformed" }
  | { outcome: "not_ready" }
  | { outcome: "already_pending" }
  | { outcome: "bad_code" }
  | { outcome: "unavailable" }
  | { outcome: "cancelled" }
  | { outcome: "failed"; code: number | null };

export interface PairPort {
  connect(code: string): Promise<ConnectOutcome>;
  cancel(): Promise<boolean>;
}

export function outcomeMessage(_outcome: ConnectOutcome): string | null {
  return null;
}
