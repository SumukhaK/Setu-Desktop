import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Clock } from "../../state/clock";
import type { LiveSession, TunnelState } from "../../state/sessionStore";
import type { AdbSnapshot } from "../adb/adbStatus";
import { RejoinBanner } from "./RejoinBanner";

const ADDR = "127.0.0.1:41377";
let now = 1000;
const clock: Clock = { now: () => now };

function advance(ms: number): void {
  act(() => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
}

function session(tunnels: Record<string, TunnelState>): LiveSession {
  return {
    sessionId: "s1",
    deviceId: "pixel-7",
    adbAddr: ADDR,
    started: null,
    status: "up",
    transport: null,
    auditTransport: null,
    tunnels,
  };
}

const down: TunnelState = {
  state: "down",
  since: 1000,
  reason: "keepalive_timeout",
  transport: "lan",
};
const lost: TunnelState = {
  state: "lost",
  reason: "rejoin_window_expired",
  at: 1000,
};

describe("RejoinBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    now = 1000;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing before 10 s and holds afterwards without new props", () => {
    render(<RejoinBanner session={session({ t1: down })} adb={null} clock={clock} />);
    advance(9999);
    expect(screen.queryByRole("status")).toBeNull();
    advance(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Phone connection interrupted. Setu is holding this session while it reconnects.",
    );
  });

  it("claims ADB is still attached only while attachment is observable", () => {
    const attached: AdbSnapshot = {
      server: "up",
      devices: [{ serial: ADDR, state: "device" }],
    };
    const { unmount } = render(
      <RejoinBanner session={session({ t1: down })} adb={attached} clock={clock} />,
    );
    advance(10001);
    expect(screen.getByRole("status")).toHaveTextContent("Local ADB is still attached.");
    unmount();

    render(<RejoinBanner session={session({ t1: down })} adb={{ server: "down" }} clock={clock} />);
    advance(10001);
    expect(screen.getByRole("status")).not.toHaveTextContent("Local ADB is still attached.");
  });

  it("shows the lost alert and hides it on Dismiss", () => {
    render(<RejoinBanner session={session({ t1: lost })} adb={null} clock={clock} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The phone is unreachable. ADB will need to reattach when it's back.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears its timer on unmount", () => {
    const { unmount } = render(
      <RejoinBanner session={session({ t1: down })} adb={null} clock={clock} />,
    );
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-arms when the boundary is 1 ms short at fire time", () => {
    let fakeNow = 1000;
    const laggingClock: Clock = { now: () => fakeNow };
    render(<RejoinBanner session={session({ t1: down })} adb={null} clock={laggingClock} />);
    expect(vi.getTimerCount()).toBe(1);

    // The clock lags the fake timers by 1 ms: the first wake fires at
    // since + 10000 by the timers, which the clock still reads as 9999.
    act(() => {
      vi.advanceTimersByTime(10000);
      fakeNow += 9999;
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(2);
      fakeNow += 1;
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Phone connection interrupted. Setu is holding this session while it reconnects.",
    );
  });
});
