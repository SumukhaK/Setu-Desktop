import type { LiveSession } from "../../state/sessionStore";
import type { AdbPort, AdbSnapshot } from "../adb/adbStatus";
import type { SessionPort } from "./sessionPort";

export function SessionCard(_props: {
  session: LiveSession;
  adb: AdbSnapshot | null;
  adbPort: AdbPort | null;
  sessionPort: SessionPort;
  clipboard: { writeText(s: string): Promise<void> };
}) {
  return <article />;
}
