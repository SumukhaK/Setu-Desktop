import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
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

describe("App saved devices", () => {
  it("renders the Saved devices section only when a devices port is given", async () => {
    const devicesPort: DevicesPort = {
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

    const { rerender } = render(<App port={daemonPort} hubPort={hubPort} />);
    expect(screen.queryByRole("heading", { name: "Saved devices" })).toBeNull();

    rerender(<App port={daemonPort} hubPort={hubPort} devicesPort={devicesPort} />);
    expect(await screen.findByRole("heading", { name: "Saved devices" })).toBeInTheDocument();
  });
});
