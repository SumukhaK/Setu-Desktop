import { describe, expect, it } from "vitest";

import type { DoctorReport } from "./diagnosticsPort";
import { checkLabel, reportText, statusView } from "./checks";

describe("diagnostics checks", () => {
  it.each([
    ["adb", "Android Debug Bridge"],
    ["state", "State directory"],
    ["paired_devices", "Paired devices"],
    ["proxy_env", "Proxy environment"],
    ["relay", "Relay"],
    ["relay_dns", "Relay DNS"],
    ["relay_reach", "Relay reachability"],
    ["audit_log", "Audit log"],
    ["future_check", "future_check"],
  ])("labels %s as %s", (name, label) => {
    expect(checkLabel(name)).toBe(label);
  });

  it.each([
    ["ok", { label: "OK", tone: "good" }],
    ["warn", { label: "Warning", tone: "warning" }],
    ["fail", { label: "Failed", tone: "critical" }],
    ["skip", { label: "Skipped", tone: "neutral" }],
    ["maybe", { label: "MAYBE", tone: "neutral" }],
    ["", { label: "UNKNOWN", tone: "neutral" }],
  ])("maps status %s to %j", (status, view) => {
    expect(statusView(status)).toEqual(view);
  });

  it("builds the exact plain-text report with and without a hint", () => {
    const report: DoctorReport = {
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
        { name: "state", status: "ok", detail: "Writable.", hint: null },
      ],
    };

    expect(reportText(report)).toBe(
      [
        "Setu doctor · 1.1.0 · windows/amd64 · some checks failed",
        "Relay reachability (relay_reach): Failed · The relay could not be reached.",
        "  Fix: Check the firewall.",
        "State directory (state): OK · Writable.",
      ].join("\n"),
    );

    expect(
      reportText({
        ...report,
        ok: true,
        checks: [{ name: "state", status: "ok", detail: "Writable.", hint: null }],
      }),
    ).toBe(
      [
        "Setu doctor · 1.1.0 · windows/amd64 · all checks passed",
        "State directory (state): OK · Writable.",
      ].join("\n"),
    );
  });
});
