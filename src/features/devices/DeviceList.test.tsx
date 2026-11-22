import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConnectOutcome } from "../pair/pairPort";
import { DeviceList } from "./DeviceList";
import type {
  DeviceRow,
  DevicesPort,
  ForgetOutcome,
  ListOutcome,
  NicknameOutcome,
} from "./devicesPort";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: (value) => {
      resolve(value);
    },
  };
}

const row = (id: string, nickname: string | null = null): DeviceRow => ({
  device_id: id,
  paired: true,
  source: "state",
  nickname,
});

function listed(devices: DeviceRow[]): ListOutcome {
  return { outcome: "listed", devices };
}

function fakePort(list: () => Promise<ListOutcome>): DevicesPort {
  return {
    list: vi.fn(list),
    forget: vi.fn(() => Promise.resolve<ForgetOutcome>({ outcome: "forgotten" })),
    setNickname: vi.fn(() =>
      Promise.resolve<NicknameOutcome>({ outcome: "saved", nickname: null }),
    ),
    connect: vi.fn(() =>
      Promise.resolve<ConnectOutcome>({
        outcome: "connected",
        session_id: "s1",
        device_id: "pixel-7",
        adb_addr: "127.0.0.1:41377",
      }),
    ),
    cancelConnect: vi.fn(() => Promise.resolve(true)),
  };
}

describe("DeviceList", () => {
  it("shows the empty copy while loading and after an empty list resolves", async () => {
    const pending = deferred<ListOutcome>();
    const port = fakePort(() => pending.promise);
    render(<DeviceList port={port} liveDeviceIds={[]} />);
    expect(screen.getByText("No saved devices yet. Pair a phone to add it.")).toBeInTheDocument();

    await act(async () => {
      pending.resolve(listed([]));
      await pending.promise;
    });
    expect(
      await screen.findByText("No saved devices yet. Pair a phone to add it."),
    ).toBeInTheDocument();
  });

  it("labels rows with a nickname or just the exact id and unknown presence", async () => {
    const port = fakePort(() =>
      Promise.resolve(listed([row("pixel-7", "Work phone"), row("tablet-9")])),
    );
    render(<DeviceList port={port} liveDeviceIds={[]} />);
    expect(
      await screen.findByRole("button", {
        name: "Work phone · pixel-7 · Presence unknown",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "tablet-9 · Presence unknown" })).toBeInTheDocument();
  });

  it("shows the list error with Refresh and reloads on Refresh", async () => {
    const list = vi
      .fn<() => Promise<ListOutcome>>()
      .mockResolvedValueOnce({ outcome: "failed", code: -32603 })
      .mockResolvedValueOnce(listed([row("pixel-7")]));
    const port = fakePort(list);
    render(<DeviceList port={port} liveDeviceIds={[]} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load saved devices (error -32603).",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      await screen.findByRole("button", { name: "pixel-7 · Presence unknown" }),
    ).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("a stale slower response never overwrites a newer list", async () => {
    const first = deferred<ListOutcome>();
    const second = deferred<ListOutcome>();
    const list = vi
      .fn<() => Promise<ListOutcome>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const port = fakePort(list);
    const { rerender } = render(<DeviceList port={port} liveDeviceIds={[]} />);

    rerender(<DeviceList port={port} liveDeviceIds={["tablet-9"]} />);
    await act(async () => {
      second.resolve(listed([row("tablet-9")]));
      await second.promise;
    });
    expect(
      await screen.findByRole("button", { name: "tablet-9 · Presence unknown" }),
    ).toBeInTheDocument();

    await act(async () => {
      first.resolve(listed([row("pixel-7")]));
      await first.promise;
    });
    expect(screen.queryByRole("button", { name: "pixel-7 · Presence unknown" })).toBeNull();
    expect(screen.getByRole("button", { name: "tablet-9 · Presence unknown" })).toBeInTheDocument();
  });

  it("reloads when the joined live device ids change", async () => {
    const list = vi.fn(() => Promise.resolve(listed([])));
    const port = fakePort(list);
    const { rerender } = render(<DeviceList port={port} liveDeviceIds={[]} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(list).toHaveBeenCalledTimes(1);

    rerender(<DeviceList port={port} liveDeviceIds={["pixel-7"]} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("opens the detail for a selected row", async () => {
    const port = fakePort(() => Promise.resolve(listed([row("pixel-7")])));
    render(<DeviceList port={port} liveDeviceIds={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "pixel-7 · Presence unknown" }));
    expect(await screen.findByRole("heading", { name: "pixel-7" })).toBeInTheDocument();
  });
});
