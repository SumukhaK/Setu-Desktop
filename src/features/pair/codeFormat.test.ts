import { describe, expect, it } from "vitest";

import { parseCodeInput } from "./codeFormat";

describe("parseCodeInput", () => {
  it("formats pasted and typed ten-digit codes, keeping leading zeroes", () => {
    for (const raw of ["0012345678", "0012-345678", "0012 345678", " 0012345678 "]) {
      expect(parseCodeInput(raw)).toEqual({
        display: "0012-345678",
        code: "0012-345678",
        problem: null,
      });
    }
    expect(parseCodeInput("0000-000000").code).toBe("0000-000000");
  });

  it("formats a partial code without offering a submit value", () => {
    expect(parseCodeInput("0012-3456")).toEqual({
      display: "0012-3456",
      code: null,
      problem: null,
    });
  });

  it("rejects bad separators and letters", () => {
    for (const raw of ["00-12345678", "0012--345678", "0012-34567a"]) {
      const parsed = parseCodeInput(raw);
      expect(parsed.code).toBeNull();
      if (raw.includes("a")) {
        expect(parsed.problem).toBe("characters");
      }
    }
  });

  it("flags more than ten digits and displays the first ten formatted", () => {
    expect(parseCodeInput("001234567890")).toEqual({
      display: "0012-345678",
      code: null,
      problem: "length",
    });
  });
});
