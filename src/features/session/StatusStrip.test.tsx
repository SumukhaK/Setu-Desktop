import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LiveSession } from "../../state/sessionStore";
import type { AdbSnapshot } from "../adb/adbStatus";
import { StatusStrip } from "./StatusStrip";

const ADDR = "127.0.0.1:41377";

const session = (overrides: Partial<LiveSession> = {}): LiveSession => ({
  sessionId: "s1",
  deviceId: "pixel-7",
  adbAddr: ADDR,
  started: null,
  status: "up",
  transport: null,
  auditTransport: null,
  tunnels: {},
  ...overrides,
});

const up = (state: string): AdbSnapshot => ({
  server: "up",
  devices: [{ serial: ADDR, state }],
});

function facts(): (string | null)[] {
  return within(screen.getByRole("list", { name: "Session status" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

describe("StatusStrip", () => {
  it.each([
    ["up", "Listener: ready"],
    ["listening", "Listener: listening"],
    ["retrying", "Listener: reconnecting"],
  ] as const)("maps listener %s to %s", (status, expected) => {
    render(<StatusStrip session={session({ status })} adb={null} />);
    expect(facts()).toContain(expected);
  });

  it.each([
    ["device", "Local ADB: attached"],
    ["unauthorized", "Local ADB: unauthorized"],
    ["offline", "Local ADB: offline"],
    ["no permissions", "Local ADB: connecting"],
  ])("maps ADB state %s to %s", (state, expected) => {
    render(<StatusStrip session={session()} adb={up(state)} />);
    expect(facts()).toContain(expected);
  });

  const snapshots: [AdbSnapshot | null, string][] = [
    [{ server: "up", devices: [] }, "Local ADB: not attached"],
    [{ server: "down" }, "Local ADB: server down"],
    [{ server: "unknown" }, "Local ADB: checking"],
    [null, "Local ADB: checking"],
  ];
  it.each(snapshots)("maps ADB snapshot %s to %s", (adb, expected) => {
    render(<StatusStrip session={session()} adb={adb} />);
    expect(facts()).toContain(expected);
  });

  it("appends the audit note only when the transport came from audit", () => {
    const { unmount } = render(
      <StatusStrip session={session({ auditTransport: "relay-ws" })} adb={null} />,
    );
    expect(facts()).toContain("Transport: Relay (WS) (from audit log)");
    unmount();

    render(
      <StatusStrip
        session={session({ transport: "relay-ws", auditTransport: "lan" })}
        adb={null}
      />,
    );
    expect(facts()).toContain("Transport: Relay (WS)");
    expect(facts()).not.toContain("Transport: Relay (WS) (from audit log)");
  });

  it("keeps the listener fact independent of a down ADB server", () => {
    render(<StatusStrip session={session()} adb={{ server: "down" }} />);
    expect(facts()).toContain("Listener: ready");
    expect(facts()).toContain("Local ADB: server down");
    expect(facts()).toContain("Transport: Path unknown");
  });
});
