import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PairAdbOutcome, PairAdbPort } from "./pairAdbPort";
import { PairAdbDialog } from "./PairAdbDialog";

function fakePort(pair: PairAdbPort["pair"]): PairAdbPort {
  return {
    pair,
    cancel: vi.fn(() => Promise.resolve(true)),
  };
}

function enter(code: string, port: string): void {
  fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: code } });
  fireEvent.change(screen.getByLabelText("Port (optional)"), { target: { value: port } });
}

describe("PairAdbDialog", () => {
  it("rejects malformed code or port without calling pair", () => {
    const pair = vi.fn((): Promise<PairAdbOutcome> =>
      Promise.resolve({ outcome: "paired", transport: "lan" }),
    );
    render(
      <PairAdbDialog
        deviceId="pixel-7"
        port={fakePort(pair)}
        onClose={vi.fn()}
        onPaired={vi.fn()}
      />,
    );

    enter("48291", "37099");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the 6-digit code and, if one is shown, a port from 1 to 65535.",
    );
    expect(pair).not.toHaveBeenCalled();

    enter("482913", "70000");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the 6-digit code and, if one is shown, a port from 1 to 65535.",
    );
    expect(pair).not.toHaveBeenCalled();
  });

  it("calls pair once with the exact code and port, or null for discovery", async () => {
    const pair = vi.fn((): Promise<PairAdbOutcome> =>
      Promise.resolve({ outcome: "paired", transport: "lan" }),
    );
    const onPaired = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(
      <PairAdbDialog
        deviceId="pixel-7"
        port={fakePort(pair)}
        onClose={onClose}
        onPaired={onPaired}
      />,
    );
    enter("482 913", "37099");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect(pair).toHaveBeenCalledTimes(1);
    expect(pair).toHaveBeenCalledWith("pixel-7", "482913", 37099);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onPaired).toHaveBeenCalledTimes(1);
    unmount();

    pair.mockClear();
    render(
      <PairAdbDialog
        deviceId="pixel-7"
        port={fakePort(pair)}
        onClose={vi.fn()}
        onPaired={vi.fn()}
      />,
    );
    enter("482913", "");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect(pair).toHaveBeenCalledWith("pixel-7", "482913", null);
  });

  it("ignores a double click and disables Pair while pending", async () => {
    let settle: (outcome: PairAdbOutcome) => void = () => undefined;
    const pair = vi.fn(
      () =>
        new Promise<PairAdbOutcome>((resolve) => {
          settle = resolve;
        }),
    );
    render(
      <PairAdbDialog
        deviceId="pixel-7"
        port={fakePort(pair)}
        onClose={vi.fn()}
        onPaired={vi.fn()}
      />,
    );
    enter("482913", "37099");
    const button = screen.getByRole("button", { name: "Pair" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(pair).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Pairing…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pair" })).toBeDisabled();
    await act(async () => {
      settle({ outcome: "paired", transport: "lan" });
      await Promise.resolve();
    });
  });

  it("pair_failed clears only the code and asks for a fresh one", async () => {
    const pair = vi.fn((): Promise<PairAdbOutcome> => Promise.resolve({ outcome: "pair_failed" }));
    render(
      <PairAdbDialog
        deviceId="pixel-7"
        port={fakePort(pair)}
        onClose={vi.fn()}
        onPaired={vi.fn()}
      />,
    );
    enter("482913", "37099");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pairing didn't work. Get a new code on the phone and try again.",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Pairing code").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Port (optional)").value).toBe("37099");
  });

  it("shows the update-phone copy for unsupported", async () => {
    const pair = vi.fn((): Promise<PairAdbOutcome> => Promise.resolve({ outcome: "unsupported" }));
    render(
      <PairAdbDialog
        deviceId="pixel-7"
        port={fakePort(pair)}
        onClose={vi.fn()}
        onPaired={vi.fn()}
      />,
    );
    enter("482913", "");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Update Setu on the phone to use this.",
    );
  });

  it("shows the not-paired recovery for -32012", async () => {
    const pair = vi.fn((): Promise<PairAdbOutcome> => Promise.resolve({ outcome: "not_paired" }));
    render(
      <PairAdbDialog
        deviceId="pixel-7"
        port={fakePort(pair)}
        onClose={vi.fn()}
        onPaired={vi.fn()}
      />,
    );
    enter("482913", "");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This device isn't paired any more. Pair it again with a new code.",
    );
  });

  it("cancels a pending pair from Cancel and on unmount", async () => {
    let settle: (outcome: PairAdbOutcome) => void = () => undefined;
    const pair = vi.fn(
      () =>
        new Promise<PairAdbOutcome>((resolve) => {
          settle = resolve;
        }),
    );
    const cancel = vi.fn(() => Promise.resolve(true));
    const port: PairAdbPort = { pair, cancel };
    const { unmount } = render(
      <PairAdbDialog deviceId="pixel-7" port={port} onClose={vi.fn()} onPaired={vi.fn()} />,
    );
    enter("482913", "");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
    await act(async () => {
      settle({ outcome: "cancelled" });
      await Promise.resolve();
    });
  });

  it("a rejected pair shows the service message and re-enables Pair", async () => {
    const pair = vi.fn((): Promise<PairAdbOutcome> => Promise.reject(new Error("ipc")));
    render(
      <PairAdbDialog
        deviceId="pixel-7"
        port={fakePort(pair)}
        onClose={vi.fn()}
        onPaired={vi.fn()}
      />,
    );
    enter("482913", "");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach the Setu service. Try again.",
    );
    expect(screen.getByRole("button", { name: "Pair" })).toBeEnabled();
  });
});
