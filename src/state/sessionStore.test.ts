import { describe, expect, it } from "vitest";

import {
  initialState,
  reduce,
  type HubEvent,
  type HubMessage,
  type LiveSession,
  type SessionInfo,
  type SessionStoreState,
} from "./sessionStore";

const info = (id: string): SessionInfo => ({
  session_id: id,
  adb_addr: "127.0.0.1:41377",
  device_id: "pixel-7",
  started: "t0",
});

const snap = (epoch: number, sessions: SessionInfo[], generation = 1): HubMessage => ({
  kind: "snapshot",
  epoch,
  generation,
  sessions,
});

const message = (event: HubEvent, epoch = 1): HubMessage => ({
  kind: "event",
  epoch,
  generation: 1,
  event,
});

const live = (id: string): LiveSession => ({
  sessionId: id,
  deviceId: "pixel-7",
  adbAddr: "127.0.0.1:41377",
  started: "t0",
  status: "up",
  transport: null,
  auditTransport: null,
  tunnels: {},
});

const synced = (sessions: SessionInfo[], epoch = 1): SessionStoreState => ({
  synced: true,
  epoch,
  generation: 1,
  live: Object.fromEntries(
    sessions.map((session) => [
      session.session_id,
      { ...live(session.session_id), deviceId: session.device_id },
    ]),
  ),
  ended: [],
});

describe("reduce", () => {
  it("a snapshot drops a stale session but keeps a still-listed one's transport and tunnels", () => {
    const state = synced([info("s1"), info("s2")]);
    state.live.s1 = {
      ...live("s1"),
      transport: "relay-wss",
      tunnels: { t1: { state: "up", transport: "relay-wss" } },
    };
    const next = reduce(state, snap(2, [info("s1")]), 0);

    expect(Object.keys(next.live)).toEqual(["s1"]);
    expect(next.live.s1?.transport).toBe("relay-wss");
    expect(next.live.s1?.tunnels).toEqual({ t1: { state: "up", transport: "relay-wss" } });
    expect(next.epoch).toBe(2);
  });

  it("ignores old-epoch messages and events before the first snapshot", () => {
    const state = synced([info("s1")], 2);
    expect(reduce(state, snap(1, []), 0)).toEqual(state);
    expect(
      reduce(state, message({ type: "session_down", session: "s1", abnormal: false }, 1), 0),
    ).toEqual(state);
    expect(
      reduce(
        initialState,
        message({ type: "session_up", session: "s1", addr: "a", device_id: "d" }),
        0,
      ),
    ).toEqual(initialState);
  });

  it("session_up is idempotent and refreshes the address", () => {
    const state = synced([info("s1")]);
    state.live.s1 = {
      ...live("s1"),
      transport: "lan",
      tunnels: { t1: { state: "up", transport: "lan" } },
    };
    const next = reduce(
      state,
      message({ type: "session_up", session: "s1", addr: "127.0.0.1:9", device_id: "pixel-7" }),
      0,
    );
    expect(next.live.s1?.status).toBe("up");
    expect(next.live.s1?.adbAddr).toBe("127.0.0.1:9");
    expect(next.live.s1?.transport).toBe("lan");
    expect(next.live.s1?.tunnels).toEqual({ t1: { state: "up", transport: "lan" } });
  });

  it("ignores path events for unknown and ended sessions", () => {
    const state = synced([info("s1")]);
    const unknown = reduce(
      state,
      message({
        type: "path_down",
        session: "s9",
        tunnel_id: "t1",
        reason: "r",
        transport: "lan",
      }),
      7,
    );
    expect(unknown.live.s9).toBeUndefined();
    const ended = reduce(
      state,
      message({ type: "session_down", session: "s1", abnormal: false }),
      7,
    );
    const afterEnd = reduce(
      ended,
      message({ type: "path_up", session: "s1", tunnel_id: "t1", transport: "lan", outage_ms: 1 }),
      8,
    );
    expect(afterEnd.live.s1).toBeUndefined();
  });

  it("a lost tunnel stays lost for a new path_up, but a new tunnel id applies", () => {
    const state = synced([info("s1")]);
    state.live.s1 = {
      ...live("s1"),
      tunnels: { t1: { state: "lost", reason: "expired" } },
    };
    const stale = reduce(
      state,
      message({ type: "path_up", session: "s1", tunnel_id: "t1", transport: "lan", outage_ms: 1 }),
      0,
    );
    expect(stale.live.s1?.tunnels.t1).toEqual({ state: "lost", reason: "expired" });

    const fresh = reduce(
      stale,
      message({ type: "path_up", session: "s1", tunnel_id: "t2", transport: "lan", outage_ms: 1 }),
      0,
    );
    expect(fresh.live.s1?.tunnels.t2).toEqual({ state: "up", transport: "lan" });
  });

  it("path_up updates the session transport", () => {
    const state = synced([info("s1")]);
    state.live.s1 = { ...live("s1"), transport: "relay-wss" };
    const next = reduce(
      state,
      message({ type: "path_up", session: "s1", tunnel_id: "t1", transport: "lan", outage_ms: 10 }),
      0,
    );
    expect(next.live.s1?.transport).toBe("lan");
  });

  it("path_down stamps since from the injected now", () => {
    const state = synced([info("s1")]);
    const next = reduce(
      state,
      message({
        type: "path_down",
        session: "s1",
        tunnel_id: "t1",
        reason: "keepalive_timeout",
        transport: "relay-wss",
      }),
      1234,
    );
    expect(next.live.s1?.tunnels.t1).toEqual({
      state: "down",
      since: 1234,
      reason: "keepalive_timeout",
      transport: "relay-wss",
    });
  });

  it("peer_closed wins over a later session_down", () => {
    const first = reduce(
      synced([info("s1")]),
      message({
        type: "peer_closed",
        session: "s1",
        device_id: "pixel-7",
        peer_reason: "ended_on_device",
      }),
      10,
    );
    const second = reduce(
      first,
      message({ type: "session_down", session: "s1", abnormal: false }),
      20,
    );
    expect(second.ended).toHaveLength(1);
    expect(second.ended[0]).toEqual({
      sessionId: "s1",
      deviceId: "pixel-7",
      reason: "peer_closed",
      at: 10,
    });
    expect(second.live.s1).toBeUndefined();
  });

  it("an abnormal session_down uses the error reason", () => {
    const next = reduce(
      synced([info("s1")]),
      message({ type: "session_down", session: "s1", abnormal: true }),
      11,
    );
    expect(next.ended[0]?.reason).toBe("error");
  });

  it("keeps at most twenty ended sessions, newest first", () => {
    let state = synced([info("s1")]);
    for (let index = 0; index < 25; index += 1) {
      const id = `s${String(index)}`;
      state = { ...state, live: { ...state.live, [id]: live(id) } };
      state = reduce(state, message({ type: "session_down", session: id, abnormal: false }), index);
    }
    expect(state.ended).toHaveLength(20);
    expect(state.ended[0]?.sessionId).toBe("s24");
    expect(state.ended[19]?.sessionId).toBe("s5");
  });

  it("unavailable clears live sessions but keeps ended, epoch and generation", () => {
    const ended: SessionStoreState["ended"] = [
      { sessionId: "old", deviceId: "pixel-7", reason: "closed", at: 4 },
    ];
    const state: SessionStoreState = { ...synced([info("s1")], 3), ended };
    const next = reduce(state, { kind: "unavailable", generation: 1 }, 0);
    expect(next.live).toEqual({});
    expect(next.synced).toBe(false);
    expect(next.ended).toEqual(ended);
    expect(next.epoch).toBe(3);
    expect(next.generation).toBe(1);
  });

  const audit = (deviceId: string, transport: string, epoch = 1): HubMessage =>
    message(
      {
        type: "audit_session_start",
        device_id: deviceId,
        tunnel_id: "4be1c0d2a9f37e11",
        transport,
      },
      epoch,
    );

  it("an audit session_start sets auditTransport only for a unique device match", () => {
    const state = synced([info("s1"), info("s2")]);
    state.live.s2 = { ...live("s2"), deviceId: "pixel-8" };

    const next = reduce(state, audit("pixel-7", "lan"), 0);
    expect(next.live.s1?.auditTransport).toBe("lan");
    expect(next.live.s2?.auditTransport).toBeNull();
  });

  it("two sessions on one device or no match leave the state unchanged", () => {
    const two = synced([info("s1"), info("s2")]);
    expect(reduce(two, audit("pixel-7", "lan"), 0)).toEqual(two);

    const none = synced([info("s1")]);
    expect(reduce(none, audit("pixel-9", "lan"), 0)).toEqual(none);
  });

  it("an old-epoch audit event is ignored", () => {
    const state = synced([info("s1")], 2);
    expect(reduce(state, audit("pixel-7", "lan", 1), 0)).toEqual(state);
  });

  it("auditTransport survives a snapshot and a session_up but path_up still wins", () => {
    let state = reduce(synced([info("s1")]), audit("pixel-7", "relay-tcp"), 0);
    expect(state.live.s1?.auditTransport).toBe("relay-tcp");

    state = reduce(state, snap(2, [info("s1")]), 0);
    expect(state.live.s1?.auditTransport).toBe("relay-tcp");

    state = reduce(
      state,
      message({ type: "session_up", session: "s1", addr: "127.0.0.1:9", device_id: "pixel-7" }),
      0,
    );
    expect(state.live.s1?.auditTransport).toBe("relay-tcp");

    state = reduce(
      state,
      message({ type: "path_up", session: "s1", tunnel_id: "t1", transport: "lan", outage_ms: 1 }),
      0,
    );
    expect(state.live.s1?.transport).toBe("lan");
    expect(state.live.s1?.auditTransport).toBe("relay-tcp");
  });

  it("never mutates a frozen input", () => {
    const state = synced([info("s1")]);
    Object.freeze(state.live.s1);
    Object.freeze(state.live);
    Object.freeze(state.ended);
    Object.freeze(state);
    const next = reduce(
      state,
      message({ type: "retrying", session: "s1", attempt: 1, delay_ms: 10 }),
      0,
    );
    expect(next).not.toBe(state);
    expect(next.live.s1?.status).toBe("retrying");
  });
});
