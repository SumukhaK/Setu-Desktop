import type { DoctorReport } from "./diagnosticsPort";

const LABELS: Record<string, string> = {
  adb: "Android Debug Bridge",
  state: "State directory",
  paired_devices: "Paired devices",
  proxy_env: "Proxy environment",
  relay: "Relay",
  relay_dns: "Relay DNS",
  relay_reach: "Relay reachability",
  audit_log: "Audit log",
};

export function checkLabel(name: string): string {
  return LABELS[name] ?? name;
}

export function statusView(status: string): {
  label: string;
  tone: "good" | "warning" | "critical" | "neutral";
} {
  switch (status) {
    case "ok":
      return { label: "OK", tone: "good" };
    case "warn":
      return { label: "Warning", tone: "warning" };
    case "fail":
      return { label: "Failed", tone: "critical" };
    case "skip":
      return { label: "Skipped", tone: "neutral" };
    default:
      return { label: status.toUpperCase() || "UNKNOWN", tone: "neutral" };
  }
}

export function reportText(report: DoctorReport): string {
  const lines = [
    `Setu doctor · ${report.version} · ${report.platform} · ${
      report.ok ? "all checks passed" : "some checks failed"
    }`,
  ];
  for (const check of report.checks) {
    lines.push(
      `${checkLabel(check.name)} (${check.name}): ${statusView(check.status).label} · ${check.detail}`,
    );
    if (check.hint !== null) {
      lines.push(`  Fix: ${check.hint}`);
    }
  }
  return lines.join("\n");
}
