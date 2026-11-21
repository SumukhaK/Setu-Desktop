export type DaemonStatus =
  | { state: "not_configured" }
  | { state: "starting" }
  | { state: "ready"; version: string | null; attached: boolean; generation: number }
  | { state: "restarting"; attempt: number; retry_in_ms: number }
  | { state: "failed"; reason: string }
  | { state: "stopped" };

export interface DaemonPort {
  current(): Promise<DaemonStatus>;
  subscribe(onStatus: (status: DaemonStatus) => void): Promise<() => void>;
}

export function statusLabel(status: DaemonStatus): string {
  return status.state;
}

export function useDaemonStatus(port: DaemonPort): DaemonStatus | null {
  void port;
  return null;
}
