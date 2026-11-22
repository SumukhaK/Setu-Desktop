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
  | { type: "peer_closed"; session: string; device_id: string; peer_reason: string }
  | {
      type: "audit_session_start";
      device_id: string;
      tunnel_id: string;
      transport: string;
    };

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
  | { state: "up"; transport: string; at: number }
  | { state: "down"; since: number; reason: string; transport: string }
  | { state: "lost"; reason: string; at: number };

export interface LiveSession {
  sessionId: string;
  deviceId: string;
  adbAddr: string | null;
  started: string | null;
  status: "listening" | "up" | "retrying";
  transport: string | null;
  auditTransport: string | null;
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

const MAX_ENDED = 20;

export const initialState: SessionStoreState = {
  synced: false,
  epoch: 0,
  generation: null,
  live: {},
  ended: [],
};

export function reduce(
  state: SessionStoreState,
  message: HubMessage,
  now: number,
): SessionStoreState {
  if (message.kind === "snapshot") {
    if (message.epoch < state.epoch) {
      return state;
    }
    const live = Object.fromEntries(
      message.sessions.map((session) => {
        const previous = state.live[session.session_id];
        const next: LiveSession = {
          sessionId: session.session_id,
          deviceId: session.device_id,
          adbAddr: session.adb_addr,
          started: session.started,
          status: "up",
          transport: previous?.transport ?? null,
          auditTransport: previous?.auditTransport ?? null,
          tunnels: previous?.tunnels ?? {},
        };
        return [session.session_id, next];
      }),
    );
    return {
      synced: true,
      epoch: message.epoch,
      generation: message.generation,
      live,
      ended: state.ended,
    };
  }
  if (message.kind === "unavailable") {
    return { ...state, synced: false, live: {} };
  }
  return reduceEvent(state, message, now);
}

function reduceEvent(
  state: SessionStoreState,
  message: Extract<HubMessage, { kind: "event" }>,
  now: number,
): SessionStoreState {
  if (!state.synced || message.epoch !== state.epoch) {
    return state;
  }
  const event = message.event;

  if (event.type === "listening" || event.type === "session_up") {
    const previous = state.live[event.session];
    const next: LiveSession = {
      sessionId: event.session,
      deviceId: event.device_id,
      adbAddr: event.addr,
      started: previous?.started ?? null,
      status: event.type === "listening" ? "listening" : "up",
      transport: previous?.transport ?? null,
      auditTransport: previous?.auditTransport ?? null,
      tunnels: previous?.tunnels ?? {},
    };
    return { ...state, live: { ...state.live, [event.session]: next } };
  }

  if (event.type === "retrying") {
    const previous = state.live[event.session];
    if (previous === undefined) {
      return state;
    }
    return {
      ...state,
      live: { ...state.live, [event.session]: { ...previous, status: "retrying" } },
    };
  }

  if (
    event.type === "session_down" ||
    event.type === "peer_closed" ||
    event.type === "session_expired"
  ) {
    const previous = state.live[event.session];
    if (previous === undefined) {
      return state;
    }
    const reason: EndReason =
      event.type === "session_down" ? (event.abnormal ? "error" : "closed") : event.type;
    const ended: EndedSession = {
      sessionId: event.session,
      deviceId: event.type === "session_down" ? previous.deviceId : event.device_id,
      reason,
      at: now,
    };
    const live = Object.fromEntries(
      Object.entries(state.live).filter(([sessionId]) => sessionId !== event.session),
    );
    return { ...state, live, ended: [ended, ...state.ended].slice(0, MAX_ENDED) };
  }

  if (event.type === "audit_session_start") {
    const matches = Object.values(state.live).filter(
      (candidate) => candidate.deviceId === event.device_id,
    );
    if (matches.length !== 1) {
      return state;
    }
    const target = matches[0];
    if (target === undefined) {
      return state;
    }
    return {
      ...state,
      live: {
        ...state.live,
        [target.sessionId]: { ...target, auditTransport: event.transport },
      },
    };
  }

  const previous = state.live[event.session];
  if (previous === undefined || previous.tunnels[event.tunnel_id]?.state === "lost") {
    return state;
  }
  const tunnels = { ...previous.tunnels };
  let transport = previous.transport;
  if (event.type === "path_down") {
    const existing = previous.tunnels[event.tunnel_id];
    tunnels[event.tunnel_id] =
      existing?.state === "down"
        ? {
            state: "down",
            since: existing.since,
            reason: event.reason,
            transport: event.transport,
          }
        : {
            state: "down",
            since: now,
            reason: event.reason,
            transport: event.transport,
          };
  } else if (event.type === "path_up") {
    tunnels[event.tunnel_id] = { state: "up", transport: event.transport, at: now };
    transport = event.transport;
  } else {
    tunnels[event.tunnel_id] = { state: "lost", reason: event.reason, at: now };
  }
  return {
    ...state,
    live: { ...state.live, [event.session]: { ...previous, transport, tunnels } },
  };
}
