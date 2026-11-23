import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuitConfirm } from "./QuitConfirm";

describe("QuitConfirm", () => {
  it("names the number of sessions that will end", () => {
    const { rerender } = render(<QuitConfirm count={1} onQuit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("1 live session will end.");
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Setu stops the local service on this computer.",
    );

    rerender(<QuitConfirm count={3} onQuit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("3 live sessions will end.");
  });

  it("labels the dialog and focuses Cancel on mount", () => {
    render(<QuitConfirm count={1} onQuit={vi.fn()} onCancel={vi.fn()} />);

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-labelledby", "quit-title");
    expect(dialog).toHaveAttribute("aria-describedby", "quit-body");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(<QuitConfirm count={1} onQuit={vi.fn()} onCancel={onCancel} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on the Cancel button", () => {
    const onCancel = vi.fn();
    render(<QuitConfirm count={1} onQuit={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onQuit once and shows Quitting… when Quit is double clicked", () => {
    const onQuit = vi.fn();
    render(<QuitConfirm count={1} onQuit={onQuit} onCancel={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Quit" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Quitting…" })).toBeDisabled();
  });
});
