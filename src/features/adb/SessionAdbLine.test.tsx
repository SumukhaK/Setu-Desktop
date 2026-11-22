import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LiveSession } from "../../state/sessionStore";
import { SessionAdbLine } from "./SessionAdbLine";
import type { AdbConnectOutcome, AdbPort, AdbSnapshot } from "./adbStatus";
import { useAdbStatus } from "./useAdbStatus";

const addr = "127.0.0.1:41377";

const session: LiveSession = {
  sessionId: "s1",
  deviceId: "pixel-7",
  adbAddr: addr,
  started: "t0",
  status: "up",
  transport: null,
  tunnels: {},
};

function up(devices: { serial: string; state: string }[]): AdbSnapshot {
  return { server: "up", devices };
}

function fakePort(initial: AdbSnapshot = { server: "unknown" }) {
  let push: (snapshot: AdbSnapshot) => void = () => undefined;
  const unsubscribe = vi.fn();
  const connect = vi.fn((): Promise<AdbConnectOutcome> => Promise.resolve({ outcome: "connected" }));
  const port: AdbPort = {
    current() {
      return Promise.resolve(initial);
    },
    subscribe(onSnapshot) {
      push = onSnapshot;
      return Promise.resolve(unsubscribe);
    },
    connect,
  };
  return {
    port,
    connect,
    unsubscribe,
    emit(snapshot: AdbSnapshot) {
      push(snapshot);
    },
  };
}

function Harness({ port }: { port: AdbPort }) {
  const adb = useAdbStatus(port);
  return <SessionAdbLine session={session} adb={adb} port={port} />;
}

describe("SessionAdbLine", () => {
  it("walks absent, unauthorized, offline and device", async () => {
    const fake = fakePort();
    render(<Harness port={fake.port} />);

    expect(await screen.findByText(`${addr} · Checking ADB…`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect ADB" })).toBeNull();

    act(() => {
      fake.emit(up([]));
    });
    expect(await screen.findByText(`${addr} · ADB not attached`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect ADB" })).toBeInTheDocument();

    act(() => {
      fake.emit(up([{ serial: addr, state: "unauthorized" }]));
    });
    expect(
      await screen.findByText(`${addr} · Allow USB debugging on the phone`),
    ).toBeInTheDocument();

    act(() => {
      fake.emit(up([{ serial: addr, state: "offline" }]));
    });
    expect(
      await screen.findByText(`${addr} · ADB sees the phone offline. Try Connect ADB again.`),
    ).toBeInTheDocument();

    act(() => {
      fake.emit(up([{ serial: addr, state: "device" }]));
    });
    expect(await screen.findByText(`${addr} · ADB attached`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect ADB" })).toBeNull();
  });

  it("shows the server-down label without a connect button", async () => {
    const fake = fakePort();
    render(<Harness port={fake.port} />);

    act(() => {
      fake.emit({ server: "down" });
    });

    expect(await screen.findByText(`${addr} · ADB server isn't running`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect ADB" })).toBeNull();
  });

  it("calls connect once and adds nothing after success", async () => {
    const fake = fakePort();
    render(<Harness port={fake.port} />);

    act(() => {
      fake.emit(up([]));
    });
    fireEvent.click(await screen.findByRole("button", { name: "Connect ADB" }));

    await waitFor(() => {
      expect(fake.connect).toHaveBeenCalledTimes(1);
    });
    expect(fake.connect).toHaveBeenCalledWith(addr);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  const failures: [AdbConnectOutcome, string][] = [
    [
      { outcome: "missing" },
      "Android Platform Tools (adb) weren't found. Install them or set SETU_ADB_PATH.",
    ],
    [{ outcome: "timed_out" }, "adb connect didn't answer in 10 seconds. Try again."],
    [
      { outcome: "not_loopback" },
      "Setu only connects ADB to this computer's loopback address.",
    ],
    [{ outcome: "failed", detail: "Connection refused" }, "adb connect failed: Connection refused"],
  ];

  it.each(failures)("shows the copy for %o", async (outcome, copy) => {
    const fake = fakePort();
    fake.connect.mockResolvedValue(outcome);
    render(<Harness port={fake.port} />);

    act(() => {
      fake.emit(up([]));
    });
    fireEvent.click(await screen.findByRole("button", { name: "Connect ADB" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
  });

  it("disables Connect ADB while a connect is running", async () => {
    const fake = fakePort();
    let resolve!: (outcome: AdbConnectOutcome) => void;
    fake.connect.mockReturnValue(
      new Promise<AdbConnectOutcome>((settle) => {
        resolve = settle;
      }),
    );
    render(<Harness port={fake.port} />);

    act(() => {
      fake.emit(up([]));
    });
    const button = await screen.findByRole("button", { name: "Connect ADB" });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    await act(async () => {
      resolve({ outcome: "connected" });
      await Promise.resolve();
    });
    expect(button).not.toBeDisabled();
  });
});
