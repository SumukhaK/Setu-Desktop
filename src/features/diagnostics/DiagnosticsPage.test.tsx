import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DoctorOutcome, DiagnosticsPort } from "./diagnosticsPort";
import { reportText } from "./checks";
import { DiagnosticsPage } from "./DiagnosticsPage";

const report: Extract<DoctorOutcome, { outcome: "report" }> = {
  outcome: "report",
  version: "1.1.0",
  platform: "windows/amd64",
  ok: false,
  checks: [
    {
      name: "relay_reach",
      status: "fail",
      detail: "The relay could not be reached.",
      hint: "Check the firewall.",
    },
    { name: "state", status: "ok", detail: "Writable.", hint: "Hidden for OK." },
    { name: "future_check", status: "maybe", detail: "A future detail.", hint: null },
  ],
};

function fakePort(run: DiagnosticsPort["run"]): DiagnosticsPort {
  return { run };
}

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

describe("DiagnosticsPage", () => {
  it("shows pending, then renders fail, ok and future checks generically", async () => {
    const pending = deferred<DoctorOutcome>();
    const run = vi.fn(() => pending.promise);
    render(
      <DiagnosticsPage port={fakePort(run)} clipboard={{ writeText: () => Promise.resolve() }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Checking local diagnostics…");

    await act(async () => {
      pending.resolve(report);
      await pending.promise;
    });
    expect(screen.getByRole("heading", { level: 1, name: "Diagnostics" })).toBeInTheDocument();
    expect(screen.getByText("Some checks failed")).toBeInTheDocument();
    expect(screen.getByText("1.1.0 · windows/amd64")).toBeInTheDocument();
    expect(screen.getByText("Relay reachability")).toBeInTheDocument();
    expect(screen.getByText("The relay could not be reached.")).toBeInTheDocument();
    expect(screen.getByText("Fix: Check the firewall.")).toBeInTheDocument();
    expect(screen.queryByText("Hidden for OK.")).toBeNull();
    expect(screen.getAllByText("future_check")).toHaveLength(2);
    expect(screen.getByText("MAYBE")).toBeInTheDocument();
  });

  it("runs again and copies exactly reportText", async () => {
    const run = vi.fn((): Promise<DoctorOutcome> => Promise.resolve(report));
    const writeText = vi.fn(() => Promise.resolve());
    render(<DiagnosticsPage port={fakePort(run)} clipboard={{ writeText }} />);
    await screen.findByText("Relay reachability");

    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    await screen.findByText("Relay reachability");
    expect(run).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    await screen.findByRole("status");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(reportText(report));
    expect(screen.getByRole("status")).toHaveTextContent("Report copied.");
  });

  it.each<[DoctorOutcome, string]>([
    [{ outcome: "not_ready" }, "The Setu service isn't ready yet. Try again in a moment."],
    [{ outcome: "timed_out" }, "Diagnostics took too long. Try again."],
    [{ outcome: "failed", code: -32603 }, "Couldn't run diagnostics (error -32603). Try again."],
    [{ outcome: "failed", code: null }, "Couldn't run diagnostics. Try again."],
  ])("shows the error copy for %j and keeps Run again", async (outcome, copy) => {
    const run = vi.fn((): Promise<DoctorOutcome> => Promise.resolve(outcome));
    render(
      <DiagnosticsPage port={fakePort(run)} clipboard={{ writeText: () => Promise.resolve() }} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(screen.getByRole("button", { name: "Run again" })).toBeEnabled();
  });

  it("shows the service message for a rejected run", async () => {
    const run = vi.fn((): Promise<DoctorOutcome> => Promise.reject(new Error("ipc")));
    render(
      <DiagnosticsPage port={fakePort(run)} clipboard={{ writeText: () => Promise.resolve() }} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach the Setu service. Try again.",
    );
  });

  it("ignores a late result after unmount", async () => {
    const pending = deferred<DoctorOutcome>();
    const run = vi.fn(() => pending.promise);
    const { unmount } = render(
      <DiagnosticsPage port={fakePort(run)} clipboard={{ writeText: () => Promise.resolve() }} />,
    );
    unmount();
    await act(async () => {
      pending.resolve(report);
      await pending.promise;
    });
    expect(screen.queryByText("Relay reachability")).toBeNull();
  });
});
