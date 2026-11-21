import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusStrip } from "./StatusStrip";
import type { DaemonPort, DaemonStatus } from "./status";

function fakePort(current: DaemonStatus): DaemonPort {
  return {
    current: () => Promise.resolve(current),
    subscribe: () => Promise.resolve(() => undefined),
  };
}

describe("StatusStrip", () => {
  it("shows Checking… first, then the daemon label", async () => {
    render(<StatusStrip port={fakePort({ state: "starting" })} />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking…");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Starting the Setu service…");
    });
  });

  it("renders no input element", async () => {
    const { container } = render(<StatusStrip port={fakePort({ state: "not_configured" })} />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("No relay configured");
    });

    expect(container.querySelector("input")).toBeNull();
  });
});
