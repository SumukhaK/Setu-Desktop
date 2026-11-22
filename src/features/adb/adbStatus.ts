export type AdbSnapshot =
  | { server: "unknown" }
  | { server: "down" }
  | { server: "up"; devices: { serial: string; state: string }[] };

export type AdbConnectOutcome =
  | { outcome: "connected" }
  | { outcome: "not_loopback" }
  | { outcome: "missing" }
  | { outcome: "timed_out" }
  | { outcome: "failed"; detail: string };

export interface AdbPort {
  current(): Promise<AdbSnapshot>;
  subscribe(cb: (snapshot: AdbSnapshot) => void): Promise<() => void>;
  connect(adbAddr: string): Promise<AdbConnectOutcome>;
}

export type Attachment =
  | "attached"
  | "unauthorized"
  | "offline"
  | "absent"
  | "server_down"
  | "unknown"
  | "other";

export function attachmentOf(_adbAddr: string | null, _snapshot: AdbSnapshot | null): Attachment {
  return "unknown";
}

export function attachmentLabel(_attachment: Attachment): string {
  return "";
}

export function connectMessage(_outcome: AdbConnectOutcome): string | null {
  return null;
}
