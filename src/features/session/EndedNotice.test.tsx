import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConnectOutcome } from "../pair/pairPort";
import type { EndedSession } from "../../state/sessionStore";
import { EndedNotice } from "./EndedNotice";

const connected: ConnectOutcome = {
  outcome: "connected",
  session_id: "s1",
  device_id: "pixel-7",
  adb_addr: "127.0.0.1:41377",
};

function ended(overrides: Partial<EndedSession> = {}): EndedSession {
  return {
    sessionId: "s1",
    deviceId: "pixel-7",
    reason: "peer_closed",
    peerReason: null,
    at: 0,
    ...overrides,
  };
}

const noReconnect = (): Promise<ConnectOutcome> => Promise.resolve(connected);

function renderNotice({
  session = ended(),
  canReconnect = true,
  reconnect = noReconnect,
  onDismiss = vi.fn(),
}: {
  session?: EndedSession;
  canReconnect?: boolean;
  reconnect?: (deviceId: string) => Promise<ConnectOutcome>;
  onDismiss?: (sessionId: string) => void;
} = {}) {
  render(
    <EndedNotice
      ended={session}
      canReconnect={canReconnect}
      reconnect={reconnect}
      onDismiss={onDismiss}
    />,
  );
  return { reconnect, onDismiss };
}

describe("EndedNotice", () => {
  it("renders nothing for a normal close", () => {
    const { container } = render(
      <EndedNotice
        ended={ended({ reason: "closed" })}
        canReconnect={false}
        reconnect={noReconnect}
        onDismiss={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the sentence for each end reason", () => {
    const { rerender } = render(
      <EndedNotice
        ended={ended({ reason: "peer_closed" })}
        canReconnect={false}
        reconnect={noReconnect}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The session was ended on the phone.");

    rerender(
      <EndedNotice
        ended={ended({ reason: "session_expired" })}
        canReconnect={false}
        reconnect={noReconnect}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The session time limit was reached.");

    rerender(
      <EndedNotice
        ended={ended({ reason: "error" })}
        canReconnect={false}
        reconnect={noReconnect}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The connection to the phone ended unexpectedly.",
    );
  });

  it("appends the peer reason only when one is present", () => {
    const { rerender } = render(
      <EndedNotice
        ended={ended({ peerReason: "User ended" })}
        canReconnect={false}
        reconnect={noReconnect}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The session was ended on the phone. Reason: User ended",
    );

    rerender(
      <EndedNotice
        ended={ended({ peerReason: null })}
        canReconnect={false}
        reconnect={noReconnect}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Reason:/)).toBeNull();
  });

  it("hides Reconnect without a devices port or a device id", () => {
    const { rerender } = render(
      <EndedNotice
        ended={ended()}
        canReconnect={false}
        reconnect={noReconnect}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();

    rerender(
      <EndedNotice
        ended={ended({ deviceId: null })}
        canReconnect
        reconnect={noReconnect}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("calls reconnect once with the device id and stays disabled while pending", async () => {
    let settle: (outcome: ConnectOutcome) => void = () => undefined;
    const reconnect = vi.fn(
      () =>
        new Promise<ConnectOutcome>((resolve) => {
          settle = resolve;
        }),
    );
    renderNotice({ reconnect });

    const button = screen.getByRole("button", { name: "Reconnect" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledWith("pixel-7");
    expect(screen.getByRole("button", { name: "Reconnecting…" })).toBeDisabled();

    await act(async () => {
      settle(connected);
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeEnabled();
  });

  it("re-enables and shows the connect message for a failed outcome", async () => {
    const reconnect = vi.fn((): Promise<ConnectOutcome> =>
      Promise.resolve({ outcome: "not_paired" }),
    );
    renderNotice({ reconnect });

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(
      await screen.findByText("This device isn't paired any more. Pair it again with a new code."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeEnabled();
  });

  it("shows nothing extra for a cancelled outcome", async () => {
    const reconnect = vi.fn((): Promise<ConnectOutcome> =>
      Promise.resolve({ outcome: "cancelled" }),
    );
    renderNotice({ reconnect });

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeEnabled();
    expect(screen.queryByText(/Try again/)).toBeNull();
  });

  it("re-enables and reports a rejected invoke", async () => {
    const reconnect = vi.fn((): Promise<ConnectOutcome> => Promise.reject(new Error("ipc")));
    renderNotice({ reconnect });

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(
      await screen.findByText("Couldn't reach the Setu service. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeEnabled();
  });

  it("dismisses with the session id", () => {
    const onDismiss = vi.fn();
    renderNotice({ session: ended({ sessionId: "s7" }), onDismiss });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledWith("s7");
  });
});
