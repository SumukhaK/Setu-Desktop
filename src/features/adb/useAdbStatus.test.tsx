import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdbPort, AdbSnapshot } from "./adbStatus";
import { useAdbStatus } from "./useAdbStatus";

const addr = "127.0.0.1:41377";

const down: AdbSnapshot = { server: "down" };
const attached: AdbSnapshot = { server: "up", devices: [{ serial: addr, state: "device" }] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("useAdbStatus", () => {
  it("subscribes before reading the current snapshot", async () => {
    const calls: string[] = [];
    const port: AdbPort = {
      subscribe() {
        calls.push("subscribe");
        return Promise.resolve(() => undefined);
      },
      current() {
        calls.push("current");
        return Promise.resolve<AdbSnapshot>({ server: "unknown" });
      },
      connect() {
        return Promise.resolve({ outcome: "connected" });
      },
    };

    const { result } = renderHook(() => useAdbStatus(port));

    await waitFor(() => {
      expect(calls).toEqual(["subscribe", "current"]);
    });
    await waitFor(() => {
      expect(result.current).toEqual({ server: "unknown" });
    });
  });

  it("lets a pushed snapshot win over a late current read", async () => {
    const current = deferred<AdbSnapshot>();
    let push: (snapshot: AdbSnapshot) => void = () => undefined;
    const port: AdbPort = {
      subscribe(onSnapshot) {
        push = onSnapshot;
        return Promise.resolve(() => undefined);
      },
      current() {
        return current.promise;
      },
      connect() {
        return Promise.resolve({ outcome: "connected" });
      },
    };

    const { result } = renderHook(() => useAdbStatus(port));

    act(() => {
      push(down);
    });
    expect(result.current).toEqual(down);

    await act(async () => {
      current.resolve(attached);
      await current.promise;
    });

    expect(result.current).toEqual(down);
  });

  it("unsubscribes on unmount", async () => {
    const unsubscribe = vi.fn();
    const port: AdbPort = {
      subscribe() {
        return Promise.resolve(unsubscribe);
      },
      current() {
        return Promise.resolve<AdbSnapshot>({ server: "unknown" });
      },
      connect() {
        return Promise.resolve({ outcome: "connected" });
      },
    };

    const { unmount } = renderHook(() => useAdbStatus(port));
    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a port", () => {
    const { result } = renderHook(() => useAdbStatus(null));
    expect(result.current).toBeNull();
  });
});
