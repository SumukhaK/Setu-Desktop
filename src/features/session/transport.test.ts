import { describe, expect, it } from "vitest";

import type { LiveSession } from "../../state/sessionStore";
import { transportLabel, transportOf } from "./transport";

const session = (overrides: Partial<LiveSession> = {}): LiveSession => ({
  sessionId: "s1",
  deviceId: "pixel-7",
  adbAddr: "127.0.0.1:41377",
  started: null,
  status: "up",
  transport: null,
  auditTransport: null,
  tunnels: {},
  ...overrides,
});

describe("transportOf", () => {
  it("prefers the path transport over the audit transport", () => {
    expect(transportOf(session({ transport: "relay-wss", auditTransport: "lan" }))).toEqual({
      transport: "relay-wss",
      source: "path",
    });
  });

  it("falls back to the audit transport, then to unknown", () => {
    expect(transportOf(session({ auditTransport: "relay-tcp" }))).toEqual({
      transport: "relay-tcp",
      source: "audit",
    });
    expect(transportOf(session())).toEqual({ transport: null, source: "unknown" });
  });

  it("a path switch updates the label (P09)", () => {
    const before = transportOf(session({ transport: "relay-wss" }));
    const after = transportOf(session({ transport: "lan" }));
    expect(transportLabel(before.transport)).toBe("Relay (WSS)");
    expect(transportLabel(after.transport)).toBe("LAN (direct)");
  });
});

describe("transportLabel", () => {
  it.each([
    ["lan", "LAN (direct)"],
    ["relay-wss", "Relay (WSS)"],
    ["relay-ws", "Relay (WS)"],
    ["relay-tcp", "Relay (TCP)"],
    [null, "Path unknown"],
    ["future-transport", "future-transport"],
  ])("labels %s as %s", (transport, label) => {
    expect(transportLabel(transport)).toBe(label);
  });
});
