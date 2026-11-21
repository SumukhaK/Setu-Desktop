import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { DaemonPort, DaemonStatus } from "./daemon/status";
import type { ConnectOutcome, PairPort } from "./features/pair/pairPort";
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
});
