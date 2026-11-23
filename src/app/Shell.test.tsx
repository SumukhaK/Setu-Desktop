import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import tauriConfig from "../../src-tauri/tauri.conf.json";
import { Shell } from "./Shell";
import type { Page } from "./Shell";

function heading(page: Page) {
  return <h1 tabIndex={-1}>{page === "workspace" ? "Workspace" : "Devices"}</h1>;
}

describe("Shell", () => {
  it("renders the chrome wordmark, navigation landmark, Solo label and footer", () => {
    render(
      <Shell page="workspace" onNavigate={() => undefined}>
        {heading("workspace")}
      </Shell>,
    );

    expect(screen.getByText("setu")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Workspace navigation" })).toBeInTheDocument();
    expect(screen.getByText("Solo")).toBeInTheDocument();
    expect(screen.getByText("Solo mode")).toBeInTheDocument();
    expect(screen.getByText("Setu-SDK v1.1.0")).toBeInTheDocument();
  });

  it("renders only the items it is given", () => {
    render(
      <Shell page="workspace" onNavigate={() => undefined}>
        {heading("workspace")}
      </Shell>,
    );

    expect(screen.queryByRole("button", { name: "Devices" })).toBeNull();
  });

  it("marks the current item and reports navigation for another one", () => {
    const onNavigate = vi.fn();
    render(
      <Shell page="workspace" onNavigate={onNavigate} items={["workspace", "devices"]}>
        {heading("workspace")}
      </Shell>,
    );

    const workspace = screen.getByRole("button", { name: "Workspace" });
    const devices = screen.getByRole("button", { name: "Devices" });
    expect(workspace).toHaveAttribute("aria-current", "page");
    expect(workspace).toHaveClass("active");
    expect(devices).not.toHaveAttribute("aria-current");

    fireEvent.click(devices);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("devices");
  });

  it("moves focus to the new page heading on navigation, not on first render", () => {
    const view = render(
      <Shell page="workspace" onNavigate={() => undefined} items={["workspace", "devices"]}>
        {heading("workspace")}
      </Shell>,
    );
    const workspaceHeading = screen.getByRole("heading", { level: 1, name: "Workspace" });
    expect(workspaceHeading).not.toHaveFocus();

    view.rerender(
      <Shell page="devices" onNavigate={() => undefined} items={["workspace", "devices"]}>
        {heading("devices")}
      </Shell>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Devices" })).toHaveFocus();
  });
});

describe("production CSP", () => {
  it("allows linked stylesheets but never inline styles", () => {
    expect(tauriConfig.app.security.csp).toContain("style-src 'self'");
    expect(tauriConfig.app.security.csp).not.toContain("unsafe-inline");
  });
});
