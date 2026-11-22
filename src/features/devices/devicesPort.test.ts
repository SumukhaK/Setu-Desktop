import { describe, expect, it } from "vitest";

import type { ConnectOutcome } from "../pair/pairPort";
import { connectMessage, forgetMessage, listMessage } from "./devicesPort";

describe("device outcome copy", () => {
  it("maps list outcomes", () => {
    expect(listMessage({ outcome: "listed", devices: [] })).toBeNull();
    expect(listMessage({ outcome: "not_ready" })).toBe(
      "The Setu service isn't ready yet. Try again in a moment.",
    );
    expect(listMessage({ outcome: "failed", code: -32603 })).toBe(
      "Couldn't load saved devices (error -32603).",
    );
    expect(listMessage({ outcome: "failed", code: null })).toBe("Couldn't load saved devices.");
  });

  it("maps forget outcomes", () => {
    expect(forgetMessage({ outcome: "forgotten" })).toBeNull();
    expect(forgetMessage({ outcome: "not_ready" })).toBe(
      "The Setu service isn't ready yet. Try again in a moment.",
    );
    expect(forgetMessage({ outcome: "not_paired" })).toBe("This device was already forgotten.");
    expect(forgetMessage({ outcome: "failed", code: -32603 })).toBe(
      "Couldn't forget this device (error -32603). Try again.",
    );
  });

  it.each<[ConnectOutcome, string | null]>([
    [
      { outcome: "connected", session_id: "s1", device_id: "pixel-7", adb_addr: "127.0.0.1:1" },
      null,
    ],
    [{ outcome: "cancelled" }, null],
    [{ outcome: "not_ready" }, "The Setu service isn't ready yet. Try again in a moment."],
    [
      { outcome: "unavailable" },
      "The phone is offline or can't be reached. Check that Setu is hosting on it.",
    ],
    [
      { outcome: "not_paired" },
      "This device isn't paired any more. Pair it again with a new code.",
    ],
    [{ outcome: "revoked" }, "Access to this device was revoked."],
    [{ outcome: "already_pending" }, "Another connection is already in progress."],
  ])("maps connect outcome %j", (outcome, copy) => {
    expect(connectMessage(outcome)).toBe(copy);
  });
});
