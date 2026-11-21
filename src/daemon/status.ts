import { useEffect, useState } from "react";

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
  switch (status.state) {
    case "not_configured":
      return "No relay configured";
    case "starting":
      return "Starting the Setu service…";
    case "ready":
      return status.version === null
        ? "Setu service ready"
        : `Setu service ready · v${status.version}`;
    case "restarting": {
      const seconds = Math.ceil(status.retry_in_ms / 1000);
      return `Restarting the Setu service (attempt ${String(status.attempt)}) in ${String(seconds)} s`;
    }
    case "failed":
      return `Setu service failed: ${status.reason}`;
    case "stopped":
      return "Setu service stopped";
  }
}

export function useDaemonStatus(port: DaemonPort): DaemonStatus | null {
  const [status, setStatus] = useState<DaemonStatus | null>(null);

  useEffect(() => {
    // One object per effect run: a stale run must not see the next run's flags.
    const state: {
      active: boolean;
      pushed: boolean;
      unsubscribe: (() => void) | null;
    } = { active: true, pushed: false, unsubscribe: null };

    const onStatus = (next: DaemonStatus) => {
      state.pushed = true;
      if (state.active) {
        setStatus(next);
      }
    };

    const applyCurrent = (current: DaemonStatus) => {
      if (state.active && !state.pushed) {
        setStatus(current);
      }
    };

    void (async () => {
      try {
        const stop = await port.subscribe(onStatus);
        if (!state.active) {
          stop();
          return;
        }
        state.unsubscribe = stop;

        applyCurrent(await port.current());
      } catch {
        // A failed read or subscription leaves the strip on "Checking…".
      }
    })();

    return () => {
      state.active = false;
      if (state.unsubscribe !== null) {
        state.unsubscribe();
      }
    };
  }, [port]);

  return status;
}
