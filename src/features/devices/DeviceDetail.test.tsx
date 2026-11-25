import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConnectOutcome } from "../pair/pairPort";
import { DeviceDetail } from "./DeviceDetail";
import type {
  DeviceRow,
  DevicesPort,
  ForgetOutcome,
  ListOutcome,
  NicknameOutcome,
} from "./devicesPort";

const device: DeviceRow = {
  device_id: "pixel-7",
  paired: true,
  source: "state",
  nickname: "Work phone",
};

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

function fakePort(overrides: Partial<DevicesPort> = {}): DevicesPort {
  return {
    list: vi.fn((): Promise<ListOutcome> => Promise.resolve({ outcome: "listed", devices: [] })),
    forget: vi.fn((): Promise<ForgetOutcome> => Promise.resolve({ outcome: "forgotten" })),
    setNickname: vi.fn((): Promise<NicknameOutcome> =>
      Promise.resolve({ outcome: "saved", nickname: null }),
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
    ...overrides,
  };
}

describe("DeviceDetail", () => {
  const changed = () => undefined;

  it("always heads the detail with the exact device id", () => {
    render(
      <DeviceDetail device={device} connected={false} port={fakePort()} onChanged={changed} />,
    );
    expect(screen.getByRole("heading", { name: "pixel-7" })).toBeInTheDocument();
  });

  it("saves the raw nickname input and reports an invalid one", async () => {
    const setNickname = vi.fn(() =>
      Promise.resolve<NicknameOutcome>({ outcome: "saved", nickname: "Desk phone" }),
    );
    const onChanged = vi.fn();
    const port = fakePort({ setNickname });
    const { unmount } = render(
      <DeviceDetail
        device={{ ...device, nickname: null }}
        connected={false}
        port={port}
        onChanged={onChanged}
      />,
    );

    fireEvent.change(screen.getByLabelText("Nickname"), {
      target: { value: "  Desk phone  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(setNickname).toHaveBeenCalledWith("pixel-7", "  Desk phone  ");
    await act(async () => {
      await Promise.resolve();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    unmount();

    const invalid = fakePort({
      setNickname: vi.fn(() => Promise.resolve<NicknameOutcome>({ outcome: "invalid" })),
    });
    render(<DeviceDetail device={device} connected={false} port={invalid} onChanged={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Use 1–40 characters, or leave it empty to remove the nickname.",
    );
  });

  it("shows Connecting… with Cancel while a connect is pending", async () => {
    const pending = deferred<ConnectOutcome>();
    const cancelConnect = vi.fn(() => Promise.resolve(true));
    const port = fakePort({ connect: () => pending.promise, cancelConnect });
    render(<DeviceDetail device={device} connected={false} port={port} onChanged={changed} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelConnect).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ outcome: "cancelled" });
      await pending.promise;
    });
  });

  it.each<[ConnectOutcome, string | null]>([
    [{ outcome: "not_ready" }, "The Setu service isn't ready yet. Try again in a moment."],
    [
      { outcome: "unavailable" },
      "The phone is offline or can't be reached. Check that Setu is hosting on it.",
    ],
    [
      { outcome: "not_paired" },
      "This device isn't paired any more. Pair it again with a new code.",
    ],
    [{ outcome: "revoked" }, "Access to this device was revoked."],
    [{ outcome: "already_pending" }, "Another connection is already in progress."],
    [{ outcome: "cancelled" }, null],
  ])("shows the connect copy for %j", async (outcome, copy) => {
    const port = fakePort({ connect: () => Promise.resolve(outcome) });
    render(<DeviceDetail device={device} connected={false} port={port} onChanged={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    if (copy === null) {
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole("alert")).toBeNull();
    } else {
      expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    }
  });

  it("shows Connected instead of Connect for a live session", async () => {
    const onChanged = vi.fn();
    render(<DeviceDetail device={device} connected port={fakePort()} onChanged={onChanged} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("P17: forget confirms first, says it does not revoke on the phone, and Keep sends nothing", async () => {
    const forget = vi.fn((): Promise<ForgetOutcome> => Promise.resolve({ outcome: "forgotten" }));
    const onChanged = vi.fn();
    const port = fakePort({ forget });
    render(<DeviceDetail device={device} connected={false} port={port} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: "Forget device" }));
    expect(forget).not.toHaveBeenCalled();
    expect(screen.getByText(/It does not revoke access on the phone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(forget).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Forget device" }));
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledWith("pixel-7");
    await act(async () => {
      await Promise.resolve();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a rejected save shows the service message", async () => {
    const setNickname = vi.fn((): Promise<NicknameOutcome> => Promise.reject(new Error("ipc")));
    const port = fakePort({ setNickname });
    render(<DeviceDetail device={device} connected={false} port={port} onChanged={changed} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't save this nickname. Try again.",
    );
  });
});
