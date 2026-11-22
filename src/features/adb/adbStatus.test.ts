import { describe, expect, it } from "vitest";

import { attachmentLabel, attachmentOf, connectMessage } from "./adbStatus";
import type { AdbSnapshot } from "./adbStatus";

const addr = "127.0.0.1:41377";

function up(devices: { serial: string; state: string }[]): AdbSnapshot {
  return { server: "up", devices };
}

describe("attachmentOf", () => {
  it("is unknown without a snapshot or before the first read", () => {
    expect(attachmentOf(addr, null)).toBe("unknown");
    expect(attachmentOf(addr, { server: "unknown" })).toBe("unknown");
  });

  it("is server_down when the ADB server is unreachable", () => {
    expect(attachmentOf(addr, { server: "down" })).toBe("server_down");
  });

  it("is absent for a session without an address", () => {
    expect(attachmentOf(null, up([{ serial: addr, state: "device" }]))).toBe("absent");
  });

  it("maps device, unauthorized and offline directly", () => {
    expect(attachmentOf(addr, up([{ serial: addr, state: "device" }]))).toBe("attached");
    expect(attachmentOf(addr, up([{ serial: addr, state: "unauthorized" }]))).toBe(
      "unauthorized",
    );
    expect(attachmentOf(addr, up([{ serial: addr, state: "offline" }]))).toBe("offline");
  });

  it("maps every other device state to other", () => {
    for (const state of ["authorizing", "connecting", "no", "recovery"]) {
      expect(attachmentOf(addr, up([{ serial: addr, state }]))).toBe("other");
    }
  });

  it("requires an exact serial match", () => {
    expect(attachmentOf(addr, up([{ serial: "127.0.0.1:4137", state: "device" }]))).toBe(
      "absent",
    );
    expect(attachmentOf(addr, up([{ serial: "127.0.0.1:413770", state: "device" }]))).toBe(
      "absent",
    );
    expect(attachmentOf(addr, up([{ serial: ` ${addr}`, state: "device" }]))).toBe("absent");
  });

  it("is absent when the address is not listed", () => {
    expect(attachmentOf(addr, up([]))).toBe("absent");
  });
});

describe("attachmentLabel", () => {
  it("uses the ticket copy for every attachment", () => {
    expect(attachmentLabel("attached")).toBe("ADB attached");
    expect(attachmentLabel("unauthorized")).toBe("Allow USB debugging on the phone");
    expect(attachmentLabel("offline")).toBe(
      "ADB sees the phone offline. Try Connect ADB again.",
    );
    expect(attachmentLabel("absent")).toBe("ADB not attached");
    expect(attachmentLabel("server_down")).toBe("ADB server isn't running");
    expect(attachmentLabel("unknown")).toBe("Checking ADB…");
    expect(attachmentLabel("other")).toBe("ADB is still connecting to the phone");
  });
});

describe("connectMessage", () => {
  it("stays silent after a successful connect", () => {
    expect(connectMessage({ outcome: "connected" })).toBeNull();
  });

  it("uses the ticket copy for every failure", () => {
    expect(connectMessage({ outcome: "missing" })).toBe(
      "Android Platform Tools (adb) weren't found. Install them or set SETU_ADB_PATH.",
    );
    expect(connectMessage({ outcome: "timed_out" })).toBe(
      "adb connect didn't answer in 10 seconds. Try again.",
    );
    expect(connectMessage({ outcome: "not_loopback" })).toBe(
      "Setu only connects ADB to this computer's loopback address.",
    );
    expect(connectMessage({ outcome: "failed", detail: "Connection refused" })).toBe(
      "adb connect failed: Connection refused",
    );
  });
});
