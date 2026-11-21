import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DaemonPort, DaemonStatus } from "./status";
import { statusLabel, useDaemonStatus } from "./status";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakePort(
  current: () => Promise<DaemonStatus>,
  subscribe: DaemonPort["subscribe"],
): DaemonPort {
  return { current, subscribe };
}

describe("statusLabel", () => {
  it("labels every daemon state", () => {
    expect(statusLabel({ state: "not_configured" })).toBe("No relay configured");
    expect(statusLabel({ state: "starting" })).toBe("Starting the Setu service…");
    expect(statusLabel({ state: "ready", version: "1.1.0", attached: true, generation: 1 })).toBe(
      "Setu service ready · v1.1.0",
    );
    expect(statusLabel({ state: "ready", version: null, attached: false, generation: 2 })).toBe(
      "Setu service ready",
    );
    expect(statusLabel({ state: "restarting", attempt: 2, retry_in_ms: 2500 })).toBe(
      "Restarting the Setu service (attempt 2) in 3 s",
    );
    expect(statusLabel({ state: "failed", reason: "daemon exited" })).toBe(
      "Setu service failed: daemon exited",
    );
    expect(statusLabel({ state: "stopped" })).toBe("Setu service stopped");
  });
});

describe("useDaemonStatus", () => {
  it("reads the current status and follows pushed updates", async () => {
    let push: (status: DaemonStatus) => void = () => undefined;
    const port = fakePort(
      () => Promise.resolve({ state: "starting" }),
      (onStatus) => {
        push = onStatus;
        return Promise.resolve(() => undefined);
      },
    );

    const { result } = renderHook(() => useDaemonStatus(port));

    await waitFor(() => {
      expect(result.current).toEqual({ state: "starting" });
    });

    act(() => {
      push({ state: "ready", version: "1.1.0", attached: true, generation: 1 });
    });

    expect(result.current).toEqual({
      state: "ready",
      version: "1.1.0",
      attached: true,
      generation: 1,
    });
  });

  it("keeps a pushed status when the initial read resolves later", async () => {
    const slow = deferred<DaemonStatus>();
    let push: (status: DaemonStatus) => void = () => undefined;
    let subscribed = false;
    const port = fakePort(
      () => slow.promise,
      (onStatus) => {
        push = onStatus;
        subscribed = true;
        return Promise.resolve(() => undefined);
      },
    );

    const { result } = renderHook(() => useDaemonStatus(port));
    await waitFor(() => {
      expect(subscribed).toBe(true);
    });

    act(() => {
      push({ state: "ready", version: null, attached: false, generation: 2 });
    });

    await act(async () => {
      slow.resolve({ state: "starting" });
      await slow.promise;
    });

    expect(result.current).toEqual({
      state: "ready",
      version: null,
      attached: false,
      generation: 2,
    });
  });

  it("unsubscribes when the component unmounts", async () => {
    const unsubscribe = vi.fn();
    let subscribed = false;
    const port = fakePort(
      () => Promise.resolve({ state: "starting" }),
      () => {
        subscribed = true;
        return Promise.resolve(unsubscribe);
      },
    );

    const { unmount } = renderHook(() => useDaemonStatus(port));
    await waitFor(() => {
      expect(subscribed).toBe(true);
    });

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
