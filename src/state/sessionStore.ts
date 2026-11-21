export interface SessionInfo {
  session_id: string;
  adb_addr: string;
  device_id: string;
  started: string;
}

export type HubEvent =
  | { type: "listening"; session: string; addr: string; device_id: string }
  | { type: "session_up"; session: string; addr: string; device_id: string }
  | { type: "retrying"; session: string; attempt: number; delay_ms: number }
  | { type: "session_down"; session: string; abnormal: boolean }
  | {
      type: "path_down";
      session: string;
      tunnel_id: string;
      reason: string;
      transport: string;
    }
  | {
      type: "path_up";
      session: string;
      tunnel_id: string;
      transport: string;
      outage_ms: number;
    }
  | {
      type: "path_lost";
      session: string;
      tunnel_id: string;
      reason: string;
      outage_ms: number;
    }
  | { type: "session_expired"; session: string; device_id: string; reason: string }
  | { type: "peer_closed"; session: string; device_id: string; peer_reason: string };

export type HubMessage =
  | {
      kind: "snapshot";
      epoch: number;
      generation: number;
      sessions: SessionInfo[];
    }
  | { kind: "event"; epoch: number; generation: number; event: HubEvent }
  | { kind: "unavailable"; generation: number };

export type TunnelState =
  | { state: "up"; transport: string }
  | { state: "down"; since: number; reason: string; transport: string }
  | { state: "lost"; reason: string };

export interface LiveSession {
  sessionId: string;
  deviceId: string;
  adbAddr: string | null;
  started: string | null;
  status: "listening" | "up" | "retrying";
  transport: string | null;
  tunnels: Record<string, TunnelState>;
}

export type EndReason = "closed" | "error" | "peer_closed" | "session_expired";

export interface EndedSession {
  sessionId: string;
  deviceId: string | null;
  reason: EndReason;
  at: number;
}

export interface SessionStoreState {
  synced: boolean;
  epoch: number;
  generation: number | null;
  live: Record<string, LiveSession>;
  ended: EndedSession[];
}

export const initialState: SessionStoreState = {
  synced: false,
  epoch: 0,
  generation: null,
  live: {},
  ended: [],
};

export function reduce(
  state: SessionStoreState,
  _message: HubMessage,
  _now: number,
): SessionStoreState {
  return state;
}

