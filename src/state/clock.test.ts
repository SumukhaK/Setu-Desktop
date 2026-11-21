import { afterEach, describe, expect, it, vi } from "vitest";

import { systemClock } from "./clock";

describe("systemClock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the monotonic performance clock", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(123.5);
    expect(systemClock.now()).toBe(123.5);
    expect(now).toHaveBeenCalled();
  });
});
