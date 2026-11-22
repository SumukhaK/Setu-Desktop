import type { LiveSession } from "../../state/sessionStore";
import { attachmentOf } from "../adb/adbStatus";
import type { AdbSnapshot, Attachment } from "../adb/adbStatus";
import { transportLabel, transportOf } from "./transport";

const listenerLabels: Record<LiveSession["status"], string> = {
  up: "ready",
  listening: "listening",
  retrying: "reconnecting",
};

const adbLabels: Record<Attachment, string> = {
  attached: "attached",
  unauthorized: "unauthorized",
  offline: "offline",
  absent: "not attached",
  server_down: "server down",
  unknown: "checking",
  other: "connecting",
};

export function StatusStrip({ session, adb }: { session: LiveSession; adb: AdbSnapshot | null }) {
  const { transport, source } = transportOf(session);
  const label = transportLabel(transport);
  const transportFact = source === "audit" ? `${label} (from audit log)` : label;

  return (
    <ul aria-label="Session status">
      <li>{`Listener: ${listenerLabels[session.status]}`}</li>
      <li>{`Local ADB: ${adbLabels[attachmentOf(session.adbAddr, adb)]}`}</li>
      <li>{`Transport: ${transportFact}`}</li>
    </ul>
  );
}
