import { describe, expect, it } from "vitest";

import type { LiveSession, TunnelState } from "../../state/sessionStore";
import { HOLD_AFTER_MS, nextWakeAt, rejoinViewOf } from "./rejoinMachine";

const session = (tunnels: Record<string, TunnelState> = {}): LiveSession => ({
  sessionId: "s1",
  deviceId: "pixel-7",
  adbAddr: "127.0.0.1:41377",
  started: null,
  status: "up",
  transport: null,
  auditTransport: null,
  tunnels,
});

const down = (since: number): TunnelState => ({
  state: "down",
  since,
  reason: "keepalive_timeout",
  transport: "relay-wss",
});
const up = (at: number, transport = "lan"): TunnelState => ({ state: "up", transport, at });
const lost = (at: number): TunnelState => ({ state: "lost", reason: "rejoin_window_expired", at });
const nobody = new Set<string>();

describe("rejoinViewOf (P14)", () => {
  it("is calm at 9 999 ms and holding at 10 000 ms", () => {
    const s = session({ t1: down(1000) });
    expect(rejoinViewOf(s, 1000 + HOLD_AFTER_MS - 1, nobody)).toEqual({ kind: "none" });
    expect(rejoinViewOf(s, 1000 + HOLD_AFTER_MS, nobody)).toEqual({ kind: "holding" });
  });

  it("does not flicker when the path recovers at 9 s", () => {
    const s = session({ t1: down(1000) });
    expect(rejoinViewOf(s, 1000, nobody)).toEqual({ kind: "none" });
    const recovered = session({ t1: up(10000) });
    expect(rejoinViewOf(recovered, 10000, nobody)).toEqual({ kind: "none" });
    expect(rejoinViewOf(recovered, 60000, nobody)).toEqual({ kind: "none" });
    expect(rejoinViewOf(recovered, 200000, nobody)).toEqual({ kind: "none" });
  });

  it("holds at 50 s and clears on the path_up", () => {
    const s = session({ t1: down(1000) });
    expect(rejoinViewOf(s, 51000, nobody)).toEqual({ kind: "holding" });
    expect(rejoinViewOf(session({ t1: up(51000) }), 51000, nobody)).toEqual({ kind: "none" });
  });

  it("shows lost only when the SDK sends path_lost, never on its own clock", () => {
    const s = session({ t1: down(1000) });
    expect(rejoinViewOf(s, 201000, nobody)).toEqual({ kind: "holding" });
    const sdkLost = session({ t1: lost(92000) });
    expect(rejoinViewOf(sdkLost, 92000, nobody)).toEqual({ kind: "lost", tunnelId: "t1" });
  });

  it("picks the latest non-dismissed lost tunnel against the latest up tunnel", () => {
    const lostOlder = session({ a: lost(100), b: up(200) });
    expect(rejoinViewOf(lostOlder, 1000, nobody)).toEqual({ kind: "none" });

    const lostNewer = session({ a: up(100), b: lost(200) });
    expect(rejoinViewOf(lostNewer, 1000, nobody)).toEqual({ kind: "lost", tunnelId: "b" });
    expect(rejoinViewOf(lostNewer, 1000, new Set(["b"]))).toEqual({ kind: "none" });

    const dismissedButDown = session({ a: down(100), b: lost(200) });
    expect(rejoinViewOf(dismissedButDown, 12000, new Set(["b"]))).toEqual({ kind: "holding" });
  });
});

describe("nextWakeAt", () => {
  it("is the next holding boundary in the future", () => {
    expect(nextWakeAt(session({ t1: down(1000) }), 4000)).toBe(11000);
    expect(nextWakeAt(session({ t1: down(1000) }), 11000)).toBeNull();
  });

  it("is null when no tunnel is down", () => {
    expect(nextWakeAt(session(), 4000)).toBeNull();
    expect(nextWakeAt(session({ t1: up(1000), t2: lost(2000) }), 4000)).toBeNull();
  });
});
