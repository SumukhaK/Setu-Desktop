import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { DaemonPort, DaemonStatus } from "./daemon/status";
import type { AdbPort } from "./features/adb/adbStatus";
import type { ConnectOutcome, PairPort } from "./features/pair/pairPort";
import type { SessionPort } from "./features/session/sessionPort";
import type { HubMessage } from "./state/sessionStore";
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
