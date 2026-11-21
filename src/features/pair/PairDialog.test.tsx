import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PairDialog } from "./PairDialog";
import type { ConnectOutcome, PairPort } from "./pairPort";

function fakePort(outcome: ConnectOutcome) {
  const connect = vi.fn(() => Promise.resolve(outcome));
  const cancel = vi.fn(() => Promise.resolve(true));
  return { port: { connect, cancel } satisfies PairPort, connect, cancel };
}

function submitCode(port: PairPort) {
  const view = render(<PairDialog port={port} onClose={() => undefined} />);
  const input = screen.getByLabelText<HTMLInputElement>("Pairing code");
  fireEvent.change(input, { target: { value: "0012345678" } });
  return { input, unmount: view.unmount };
}

describe("PairDialog", () => {
  it("P02 formats the code as typed and submits the formatted value", () => {
    const { port, connect } = fakePort({
      outcome: "connected",
      session_id: "s1",
      device_id: "p",
      adb_addr: "a",
    });
    const { input } = submitCode(port);
    expect(input.value).toBe("0012-345678");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("0012-345678");
  });

  it("keeps Connect disabled for letters and partial codes", () => {
    const { port } = fakePort({
      outcome: "connected",
      session_id: "s1",
      device_id: "p",
      adb_addr: "a",
    });
    render(<PairDialog port={port} onClose={() => undefined} />);
    const input = screen.getByLabelText<HTMLInputElement>("Pairing code");
    fireEvent.change(input, { target: { value: "0012-34567a" } });
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(screen.getByText("Use only the 10 digits shown on the phone.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "0012-3456" } });
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("P19 Cancel signals the pending connect and closes cleanly", async () => {
    let resolveConnect: (outcome: ConnectOutcome) => void = () => undefined;
    const connect = vi.fn(
      () =>
        new Promise<ConnectOutcome>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    const cancel = vi.fn(() => {
      resolveConnect({ outcome: "cancelled" });
      return Promise.resolve(true);
    });
    const port: PairPort = { connect, cancel };
    const onClose = vi.fn();
    render(<PairDialog port={port} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Pairing code"), {
      target: { value: "0012-345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows exact error copy and keeps the typed code", async () => {
    const cases: Array<[ConnectOutcome, string]> = [
      [
        { outcome: "bad_code" },
        "That code didn't work. Check the 10 digits and that the phone is still hosting. After 3 wrong tries the phone shows a new code.",
      ],
      [
        { outcome: "unavailable" },
        "The phone can't be reached right now. Make sure Setu is hosting on the phone, then try again.",
      ],
      [{ outcome: "not_ready" }, "The Setu service isn't ready yet. Try again in a moment."],
      [{ outcome: "already_pending" }, "A connection is already in progress."],
      [{ outcome: "malformed" }, "Enter the 10 digits shown on the phone."],
      [{ outcome: "failed", code: 12 }, "Couldn't connect (error 12). Try again."],
      [{ outcome: "failed", code: null }, "Couldn't connect. Try again."],
    ];
    for (const [outcome, copy] of cases) {
      const { port } = fakePort(outcome);
      const { unmount } = submitCode(port);
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(copy);
      expect(screen.getByLabelText<HTMLInputElement>("Pairing code").value).toBe("0012-345678");
      unmount();
    }
  });

  it("never shows a timer or expiry text and stores nothing", async () => {
    const { port } = fakePort({ outcome: "bad_code" });
    submitCode(port);
    expect(document.body.textContent).not.toMatch(/\d+\s*(s|sec|min)|expire/i);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByRole("alert");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
