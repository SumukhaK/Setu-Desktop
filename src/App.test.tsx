import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { WindowPort } from "./app/windowLifecycle";
import type { DaemonPort, DaemonStatus } from "./daemon/status";
import type {
  DevicesPort,
  ForgetOutcome,
  ListOutcome,
  NicknameOutcome,
} from "./features/devices/devicesPort";
import type { AdbPort } from "./features/adb/adbStatus";
import type { ConnectOutcome, PairPort } from "./features/pair/pairPort";
import type { SessionPort } from "./features/session/sessionPort";
import type { Clock } from "./state/clock";
import type { HubEvent, HubMessage } from "./state/sessionStore";
import type { SessionHubPort } from "./state/useSessions";

const daemonPort: DaemonPort = {
  current(): Promise<DaemonStatus> {
    return Promise.resolve({ state: "starting" });
  },
  subscribe() {
    return Promise.resolve(() => undefined);
  },
};

const hubPort: SessionHubPort = {
  subscribe() {
    return Promise.resolve(() => undefined);
  },
  resync() {
    return Promise.resolve();
  },
};

const pairPort: PairPort = {
  connect: vi.fn((): Promise<ConnectOutcome> => Promise.resolve({ outcome: "malformed" })),
  cancel: vi.fn(() => Promise.resolve(false)),
};

function fakeDevicesPort(): DevicesPort {
  return {
    list: vi.fn((): Promise<ListOutcome> => Promise.resolve({ outcome: "listed", devices: [] })),
    forget: vi.fn((): Promise<ForgetOutcome> => Promise.resolve({ outcome: "forgotten" })),
    setNickname: vi.fn((): Promise<NicknameOutcome> =>
      Promise.resolve({ outcome: "saved", nickname: null }),
    ),
    connect: vi.fn((): Promise<ConnectOutcome> =>
      Promise.resolve({
        outcome: "connected",
        session_id: "s1",
        device_id: "pixel-7",
        adb_addr: "127.0.0.1:41377",
      }),
    ),
    cancelConnect: vi.fn(() => Promise.resolve(true)),
  };
}

function fakeHub() {
  let push: (message: HubMessage) => void = () => undefined;
  const subscribe = vi.fn((onMessage: (message: HubMessage) => void) => {
    push = onMessage;
    return Promise.resolve(() => undefined);
  });
  const hub: SessionHubPort = {
    subscribe,
    resync() {
      return Promise.resolve();
    },
  };
  return {
    hub,
    subscribe,
    push: (message: HubMessage) => {
      push(message);
    },
  };
}

const liveSnapshot: HubMessage = {
  kind: "snapshot",
  epoch: 1,
  generation: 1,
  sessions: [
    {
      session_id: "s1",
      adb_addr: "127.0.0.1:41377",
      device_id: "pixel-7",
      started: "t0",
    },
  ],
};

describe("App", () => {
  it("opens the pairing dialog and closes it again", () => {
    render(<App port={daemonPort} hubPort={hubPort} pairPort={pairPort} />);
    fireEvent.click(screen.getByRole("button", { name: "Pair new device" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the live session line when ADB is down", async () => {
    let push: (message: HubMessage) => void = () => undefined;
    const hub: SessionHubPort = {
      subscribe(onMessage) {
        push = onMessage;
        return Promise.resolve(() => undefined);
      },
      resync() {
        return Promise.resolve();
      },
    };
    const adbPort: AdbPort = {
      current() {
        return Promise.resolve({ server: "down" });
      },
      subscribe() {
        return Promise.resolve(() => undefined);
      },
      connect() {
        return Promise.resolve({ outcome: "connected" });
      },
    };

    render(<App port={daemonPort} hubPort={hub} adbPort={adbPort} />);
    act(() => {
      push({
        kind: "snapshot",
        epoch: 1,
        generation: 1,
        sessions: [
          {
            session_id: "s1",
            adb_addr: "127.0.0.1:41377",
            device_id: "pixel-7",
            started: "t0",
          },
        ],
      });
    });

    expect(await screen.findByText("1 live session")).toBeInTheDocument();
    expect(
      await screen.findByText("127.0.0.1:41377 · ADB server isn't running"),
    ).toBeInTheDocument();
  });

  it("renders one card per live session and drops it on session_down", async () => {
    let push: (message: HubMessage) => void = () => undefined;
    const hub: SessionHubPort = {
      subscribe(onMessage) {
        push = onMessage;
        return Promise.resolve(() => undefined);
      },
      resync() {
        return Promise.resolve();
      },
    };
    const adbPort: AdbPort = {
      current: () => Promise.resolve({ server: "down" }),
      subscribe: () => Promise.resolve(() => undefined),
      connect: () => Promise.resolve({ outcome: "connected" }),
    };
    const sessionPort: SessionPort = {
      stop: () => Promise.resolve({ outcome: "no_session" }),
    };

    render(
      <App
        port={daemonPort}
        hubPort={hub}
        adbPort={adbPort}
        sessionPort={sessionPort}
        clipboard={{ writeText: () => Promise.resolve() }}
      />,
    );

    act(() => {
      push({
        kind: "snapshot",
        epoch: 1,
        generation: 1,
        sessions: [
          {
            session_id: "s1",
            adb_addr: "127.0.0.1:41377",
            device_id: "pixel-7",
            started: "t0",
          },
        ],
      });
    });

    expect(await screen.findByRole("article")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "pixel-7" })).toBeInTheDocument();

    act(() => {
      push({
        kind: "event",
        epoch: 1,
        generation: 1,
        event: { type: "session_down", session: "s1", abnormal: false },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("article")).toBeNull();
    });
  });
});

describe("App rejoin banner and denial (P14)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const endings: HubEvent[] = [
    {
      type: "peer_closed",
      session: "s1",
      device_id: "pixel-7",
      peer_reason: "ended_on_device",
    },
    {
      type: "session_expired",
      session: "s1",
      device_id: "pixel-7",
      reason: "max_session_seconds",
    },
    { type: "session_down", session: "s1", abnormal: true },
  ];

  it.each(endings)("a %j removes the card and the holding banner", (ending) => {
    vi.useFakeTimers();
    let now = 1000;
    const clock: Clock = { now: () => now };
    let push: (message: HubMessage) => void = () => undefined;
    const hub: SessionHubPort = {
      subscribe(onMessage) {
        push = onMessage;
        return Promise.resolve(() => undefined);
      },
      resync() {
        return Promise.resolve();
      },
    };
    const adbPort: AdbPort = {
      current: () => Promise.resolve({ server: "down" }),
      subscribe: () => Promise.resolve(() => undefined),
      connect: () => Promise.resolve({ outcome: "connected" }),
    };

    render(<App port={daemonPort} hubPort={hub} adbPort={adbPort} clock={clock} />);
    act(() => {
      push({
        kind: "snapshot",
        epoch: 1,
        generation: 1,
        sessions: [
          {
            session_id: "s1",
            adb_addr: "127.0.0.1:41377",
            device_id: "pixel-7",
            started: "t0",
          },
        ],
      });
    });
    act(() => {
      push({
        kind: "event",
        epoch: 1,
        generation: 1,
        event: {
          type: "path_down",
          session: "s1",
          tunnel_id: "4be1c0d2a9f37e11",
          reason: "keepalive_timeout",
          transport: "relay-wss",
        },
      });
    });
    act(() => {
      now += 15000;
      vi.advanceTimersByTime(15000);
    });
    expect(screen.getByText(/Phone connection interrupted/)).toBeInTheDocument();

    act(() => {
      push({ kind: "event", epoch: 1, generation: 1, event: ending });
    });
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByText(/Phone connection interrupted/)).toBeNull();
  });
});

describe("App shell navigation", () => {
  it("opens on the Workspace page with no Devices item without a devices port", () => {
    render(<App port={daemonPort} hubPort={hubPort} />);

    expect(screen.getByRole("heading", { level: 1, name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByText("This computer · Solo · Local-first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Devices" })).toBeNull();
  });

  it("switches to Devices, focuses its heading and hides the session cards", async () => {
    const { hub, push } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} devicesPort={fakeDevicesPort()} />);
    act(() => {
      push(liveSnapshot);
    });
    expect(await screen.findByRole("article")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));

    expect(screen.getByRole("heading", { level: 1, name: "Devices" })).toHaveFocus();
    expect(screen.getByText("Paired phones on this computer")).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
    expect(await screen.findByRole("heading", { name: "Saved devices" })).toBeInTheDocument();
  });

  it("keeps a session live across both switches, including an event while on Devices", async () => {
    const { hub, push } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} devicesPort={fakeDevicesPort()} />);
    act(() => {
      push(liveSnapshot);
    });
    expect(await screen.findByRole("article")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    act(() => {
      push({
        kind: "event",
        epoch: 1,
        generation: 1,
        event: {
          type: "path_up",
          session: "s1",
          tunnel_id: "t1",
          transport: "relay-wss",
          outage_ms: 0,
        },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    expect(await screen.findByRole("article")).toBeInTheDocument();
    expect(screen.getByText("Transport: Relay (WSS)")).toBeInTheDocument();
  });

  it("subscribes to the hub once across both switches", async () => {
    const { hub, subscribe } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} devicesPort={fakeDevicesPort()} />);
    await waitFor(() => {
      expect(subscribe).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps the pairing dialog open after a round trip to Devices", () => {
    render(
      <App
        port={daemonPort}
        hubPort={hubPort}
        pairPort={pairPort}
        devicesPort={fakeDevicesPort()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pair new device" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("App saved devices", () => {
  it("renders the Saved devices section only when a devices port is given", async () => {
    const devicesPort = fakeDevicesPort();

    const { rerender } = render(<App port={daemonPort} hubPort={hubPort} />);
    expect(screen.queryByRole("heading", { name: "Saved devices" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Devices" })).toBeNull();

    rerender(<App port={daemonPort} hubPort={hubPort} devicesPort={devicesPort} />);
    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    expect(await screen.findByRole("heading", { name: "Saved devices" })).toBeInTheDocument();
  });
});

describe("App end states and Reconnect (UK-03)", () => {
  const pushSnapshot = (
    push: (message: HubMessage) => void,
    deviceId = "dev-1",
    epoch = 1,
  ): void => {
    act(() => {
      push({
        kind: "snapshot",
        epoch,
        generation: 1,
        sessions: [
          {
            session_id: "s1",
            adb_addr: "127.0.0.1:41377",
            device_id: deviceId,
            started: "t0",
          },
        ],
      });
    });
  };

  const pushEvent = (push: (message: HubMessage) => void, event: HubEvent): void => {
    act(() => {
      push({ kind: "event", epoch: 1, generation: 1, event });
    });
  };

  const peerClosed = (peer_reason: string): HubEvent => ({
    type: "peer_closed",
    session: "s1",
    device_id: "dev-1",
    peer_reason,
  });

  const fakeReconnectPort = () => {
    const connect = vi.fn((): Promise<ConnectOutcome> =>
      Promise.resolve({
        outcome: "connected",
        session_id: "s1",
        device_id: "dev-1",
        adb_addr: "127.0.0.1:41377",
      }),
    );
    return { devicesPort: { ...fakeDevicesPort(), connect }, connect };
  };

  it("shows the peer_closed reason and never retries on its own", async () => {
    const { devicesPort, connect } = fakeReconnectPort();
    const { hub, push } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} devicesPort={devicesPort} />);
    pushSnapshot(push);
    expect(await screen.findByRole("article")).toBeInTheDocument();

    pushEvent(push, peerClosed("User ended"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The session was ended on the phone.");
    expect(alert).toHaveTextContent("Reason: User ended");
    expect(screen.queryByRole("article")).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  const endings: Array<[HubEvent, string]> = [
    [
      {
        type: "session_expired",
        session: "s1",
        device_id: "dev-1",
        reason: "max_session_seconds",
      },
      "The session time limit was reached.",
    ],
    [
      { type: "session_down", session: "s1", abnormal: true },
      "The connection to the phone ended unexpectedly.",
    ],
  ];

  it.each(endings)("shows a notice for %j", async (event, text) => {
    const { hub, push } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} />);
    pushSnapshot(push);
    expect(await screen.findByRole("article")).toBeInTheDocument();

    pushEvent(push, event);

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("shows nothing for a normal Disconnect", async () => {
    const { hub, push } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} />);
    pushSnapshot(push);
    expect(await screen.findByRole("article")).toBeInTheDocument();

    pushEvent(push, { type: "session_down", session: "s1", abnormal: false });

    await waitFor(() => {
      expect(screen.queryByRole("article")).toBeNull();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reconnects by device id and hides the notice once that device is live", async () => {
    const { devicesPort, connect } = fakeReconnectPort();
    const { hub, push } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} devicesPort={devicesPort} />);
    pushSnapshot(push);
    expect(await screen.findByRole("article")).toBeInTheDocument();
    pushEvent(push, peerClosed("User ended"));

    fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("dev-1");

    pushSnapshot(push, "dev-1", 2);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    expect(await screen.findByRole("article")).toBeInTheDocument();
  });

  it("keeps a dismissed notice hidden after a Devices round trip", async () => {
    const { hub, push } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} devicesPort={fakeDevicesPort()} />);
    pushSnapshot(push);
    expect(await screen.findByRole("article")).toBeInTheDocument();
    pushEvent(push, peerClosed("User ended"));

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a notice without Reconnect when there is no devices port", async () => {
    const { hub, push } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} />);
    pushSnapshot(push);
    expect(await screen.findByRole("article")).toBeInTheDocument();

    pushEvent(push, peerClosed("User ended"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The session was ended on the phone.",
    );
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});

describe("App tray and quit (DT-09)", () => {
  function fakeWindowPort() {
    let notify: () => void = () => undefined;
    const unsubscribe = vi.fn(() => undefined);
    const hide = vi.fn(() => Promise.resolve());
    const quit = vi.fn(() => Promise.resolve());
    const onQuitRequested = vi.fn((cb: () => void) => {
      notify = cb;
      return Promise.resolve(unsubscribe);
    });
    const port: WindowPort = { hide, quit, onQuitRequested };
    return {
      port,
      hide,
      quit,
      onQuitRequested,
      unsubscribe,
      fire: () => {
        notify();
      },
    };
  }

  async function subscribeTo(fixture: ReturnType<typeof fakeWindowPort>): Promise<void> {
    await waitFor(() => {
      expect(fixture.onQuitRequested).toHaveBeenCalledTimes(1);
    });
  }

  it("quits at once with no live sessions and shows no dialog", async () => {
    const window = fakeWindowPort();
    render(<App port={daemonPort} hubPort={hubPort} windowPort={window.port} />);
    await subscribeTo(window);

    act(() => {
      window.fire();
    });

    await waitFor(() => {
      expect(window.quit).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("confirms with one live session, cancels, then quits", async () => {
    const window = fakeWindowPort();
    const { hub, push } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} windowPort={window.port} />);
    await subscribeTo(window);
    act(() => {
      push(liveSnapshot);
    });
    expect(await screen.findByRole("article")).toBeInTheDocument();

    act(() => {
      window.fire();
    });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("1 live session will end.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(window.quit).not.toHaveBeenCalled();

    act(() => {
      window.fire();
    });
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));

    await waitFor(() => {
      expect(window.quit).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the confirm on the Devices page too", async () => {
    const window = fakeWindowPort();
    const { hub, push } = fakeHub();
    render(
      <App
        port={daemonPort}
        hubPort={hub}
        devicesPort={fakeDevicesPort()}
        windowPort={window.port}
      />,
    );
    await subscribeTo(window);
    act(() => {
      push(liveSnapshot);
    });
    fireEvent.click(screen.getByRole("button", { name: "Devices" }));

    act(() => {
      window.fire();
    });

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Devices" })).toBeInTheDocument();
  });

  it("moves to tray only with a window port", () => {
    const window = fakeWindowPort();
    const { rerender } = render(
      <App port={daemonPort} hubPort={hubPort} windowPort={window.port} />,
    );
    expect(screen.getByRole("button", { name: "Move to tray" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move to tray" }));
    expect(window.hide).toHaveBeenCalledTimes(1);

    rerender(<App port={daemonPort} hubPort={hubPort} />);
    expect(screen.queryByRole("button", { name: "Move to tray" })).toBeNull();
  });

  it("unsubscribes from quit-requested on unmount", async () => {
    const window = fakeWindowPort();
    const { unmount } = render(
      <App port={daemonPort} hubPort={hubPort} windowPort={window.port} />,
    );
    await subscribeTo(window);

    unmount();

    expect(window.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("App robustness (UK-04)", () => {
  it("keeps the pairing draft across a Devices round trip", () => {
    const { hub } = fakeHub();
    render(
      <App port={daemonPort} hubPort={hub} pairPort={pairPort} devicesPort={fakeDevicesPort()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pair new device" }));
    fireEvent.change(screen.getByLabelText("Pairing code"), {
      target: { value: "0012345678" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    expect(screen.getByLabelText<HTMLInputElement>("Pairing code").value).toBe("0012-345678");
  });

  it("cancels a pending connect when the Workspace page is left", () => {
    const connect = vi.fn(() => new Promise<ConnectOutcome>(() => undefined));
    const cancel = vi.fn(() => Promise.resolve(true));
    const port: PairPort = { connect, cancel };
    const { hub } = fakeHub();
    render(<App port={daemonPort} hubPort={hub} pairPort={port} devicesPort={fakeDevicesPort()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pair new device" }));
    fireEvent.change(screen.getByLabelText("Pairing code"), {
      target: { value: "0012345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Connecting…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("clears the draft when the dialog closes", () => {
    render(<App port={daemonPort} hubPort={hubPort} pairPort={pairPort} />);
    fireEvent.click(screen.getByRole("button", { name: "Pair new device" }));
    fireEvent.change(screen.getByLabelText("Pairing code"), {
      target: { value: "0012345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Pairing code")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pair new device" }));

    expect(screen.getByLabelText<HTMLInputElement>("Pairing code").value).toBe("");
  });

  it("a rejected quit shows the alert and a second request retries", async () => {
    let notify: () => void = () => undefined;
    const unsubscribe = vi.fn(() => undefined);
    const quit = vi.fn(() => Promise.reject(new Error("ipc")));
    const hide = vi.fn(() => Promise.resolve());
    const onQuitRequested = vi.fn((cb: () => void) => {
      notify = cb;
      return Promise.resolve(unsubscribe);
    });
    const port: WindowPort = { hide, quit, onQuitRequested };
    render(<App port={daemonPort} hubPort={hubPort} windowPort={port} />);
    await waitFor(() => {
      expect(onQuitRequested).toHaveBeenCalledTimes(1);
    });

    act(() => {
      notify();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't quit Setu. Try again.");
    expect(quit).toHaveBeenCalledTimes(1);

    act(() => {
      notify();
    });
    await waitFor(() => {
      expect(quit).toHaveBeenCalledTimes(2);
    });
  });
});
