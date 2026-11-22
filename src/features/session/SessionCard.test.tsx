import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LiveSession } from "../../state/sessionStore";
import type { AdbPort } from "../adb/adbStatus";
import { SessionCard } from "./SessionCard";
import type { SessionPort, StopOutcome } from "./sessionPort";

const ADDR = "127.0.0.1:41377";

const session = (overrides: Partial<LiveSession> = {}): LiveSession => ({
  sessionId: "s1",
  deviceId: "pixel-7",
  adbAddr: ADDR,
  started: null,
  status: "up",
  transport: null,
  auditTransport: null,
  tunnels: {},
  ...overrides,
});

const adbPort: AdbPort = {
  current: () => Promise.resolve({ server: "down" }),
  subscribe: () => Promise.resolve(() => undefined),
  connect: () => Promise.resolve({ outcome: "connected" }),
};

function deferred(): { outcome: Promise<StopOutcome>; resolve: (value: StopOutcome) => void } {
  let resolve: (value: StopOutcome) => void = () => undefined;
  const outcome = new Promise<StopOutcome>((done) => {
    resolve = done;
  });
  return { outcome, resolve: (value) => resolve(value) };
}

describe("SessionCard", () => {
  it("shows the device heading, status strip and ADB line", async () => {
    render(
      <SessionCard
        session={session()}
        adb={null}
        adbPort={adbPort}
        sessionPort={{ stop: () => Promise.resolve({ outcome: "stopped" }) }}
        clipboard={{ writeText: () => Promise.resolve() }}
      />,
    );
    expect(screen.getByRole("article")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "pixel-7" })).toBeInTheDocument();
    expect(await screen.findByText(`${ADDR} · Checking ADB…`)).toBeInTheDocument();
  });

  it("P17: Disconnect stops the selected id once and is disabled while pending", async () => {
    const pending = deferred();
    const stop = vi.fn(() => pending.outcome);
    render(
      <SessionCard
        session={session()}
        adb={null}
        adbPort={adbPort}
        sessionPort={{ stop }}
        clipboard={{ writeText: () => Promise.resolve() }}
      />,
    );

    const button = screen.getByRole("button", { name: "Disconnect" });
    fireEvent.click(button);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith("s1");
    expect(button).toBeDisabled();

    await act(async () => {
      pending.resolve({ outcome: "stopped" });
    });
    expect(button).not.toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [
      { outcome: "not_ready" } as StopOutcome,
      "The Setu service isn't ready yet. Try again in a moment.",
    ],
    [{ outcome: "invalid" } as StopOutcome, "This session can't be stopped from here."],
    [
      { outcome: "failed", code: -32603 } as StopOutcome,
      "Couldn't disconnect (error -32603). Try again.",
    ],
    [{ outcome: "failed", code: null } as StopOutcome, "Couldn't disconnect. Try again."],
  ])("shows the exact copy for %j", async (outcome, copy) => {
    const port: SessionPort = { stop: () => Promise.resolve(outcome) };
    render(
      <SessionCard
        session={session()}
        adb={null}
        adbPort={adbPort}
        sessionPort={port}
        clipboard={{ writeText: () => Promise.resolve() }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
  });

  it("stays silent for stopped and no_session", async () => {
    for (const outcome of [{ outcome: "stopped" }, { outcome: "no_session" }] as StopOutcome[]) {
      const port: SessionPort = { stop: () => Promise.resolve(outcome) };
      const { unmount } = render(
        <SessionCard
          session={session()}
          adb={null}
          adbPort={adbPort}
          sessionPort={port}
          clipboard={{ writeText: () => Promise.resolve() }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole("alert")).toBeNull();
      unmount();
    }
  });

  it("Copy address writes the exact loopback address and shows Copied", async () => {
    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
    render(
      <SessionCard
        session={session()}
        adb={null}
        adbPort={adbPort}
        sessionPort={{ stop: () => Promise.resolve({ outcome: "stopped" }) }}
        clipboard={clipboard}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith(ADDR);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("hides Copy address when the address is pending", () => {
    render(
      <SessionCard
        session={session({ adbAddr: null })}
        adb={null}
        adbPort={adbPort}
        sessionPort={{ stop: () => Promise.resolve({ outcome: "stopped" }) }}
        clipboard={{ writeText: () => Promise.resolve() }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  });
});
