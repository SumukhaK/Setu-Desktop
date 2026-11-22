import { describe, expect, it } from "vitest";

import { outcomeMessage } from "./pairPort";

describe("pairPort outcome copy", () => {
  it("names the two new device outcomes", () => {
    expect(outcomeMessage({ outcome: "not_paired" })).toBe(
      "This device isn't paired any more. Pair it again with a new code.",
    );
    expect(outcomeMessage({ outcome: "revoked" })).toBe("Access to this device was revoked.");
  });
});
