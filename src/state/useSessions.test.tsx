import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { DaemonPort, DaemonStatus } from "../daemon/status";
import type { Clock } from "./clock";
import type { HubMessage, SessionInfo } from "./sessionStore";
import { useSessions } from "./useSessions";
import type { SessionHubPort } from "./useSessions";

const now: Clock = { now: () => 42 };

const info: SessionInfo = {
  session_id: "s1",
  adb_addr: "127.0.0.1:41377",
  device_id: "pixel-7",
  started: "t0",
};

const snapshot: HubMessage = { kind: "snapshot", epoch: 1, generation: 1, sessions: [info] };

function fakeHub() {
  let push: (message: HubMessage) => void = () => undefined;
  const calls: string[] = [];
  const unsubscribe = vi.fn();
  const port: SessionHubPort = {
    subscribe(onMessage) {
      calls.push("subscribe");
      push = onMessage;
      return Promise.resolve(unsubscribe);
    },
    resync() {
      calls.push("resync");
      return Promise.resolve();
    },
  };
  return {
    port,
    calls,
    unsubscribe,
    emit(message: HubMessage) {
      act(() => {
        push(message);
      });
    },
  };
}

const daemonPort: DaemonPort = {
  current(): Promise<DaemonStatus> {
    return Promise.resolve({ state: "starting" });
  },
  subscribe() {
    return Promise.resolve(() => undefined);
  },
};

describe("useSessions", () => {
  it("subscribes before asking for a fresh snapshot", async () => {
    const { port, calls } = fakeHub();
    renderHook(() => useSessions(port, now));
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toEqual(["subscribe", "resync"]);
  });

  it("reduces pushed messages into the returned state", async () => {
    const hub = fakeHub();
    const { result } = renderHook(() => useSessions(hub.port, now));
    await act(async () => {
      await Promise.resolve();
    });
    hub.emit(snapshot);
    expect(result.current.synced).toBe(true);
    expect(result.current.live.s1?.deviceId).toBe("pixel-7");
    hub.emit({
      kind: "event",
      epoch: 1,
      generation: 1,
      event: { type: "path_up", session: "s1", tunnel_id: "t1", transport: "lan", outage_ms: 1 },
    });
    expect(result.current.live.s1?.transport).toBe("lan");
  });

  it("unsubscribes on unmount", async () => {
    const hub = fakeHub();
    const { unmount } = renderHook(() => useSessions(hub.port, now));
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    expect(hub.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("App session line", () => {
  it("shows no live sessions, then one after a snapshot", async () => {
    const hub = fakeHub();
    render(<App port={daemonPort} hubPort={hub.port} />);
    expect(screen.getByText("No live sessions")).toBeInTheDocument();

    hub.emit(snapshot);
    expect(await screen.findByText("1 live session")).toBeInTheDocument();
  });
});
