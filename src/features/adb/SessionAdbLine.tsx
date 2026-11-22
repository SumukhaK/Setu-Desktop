import type { LiveSession } from "../../state/sessionStore";
import type { AdbPort, AdbSnapshot } from "./adbStatus";

export function SessionAdbLine(_props: {
  session: LiveSession;
  adb: AdbSnapshot | null;
  port: AdbPort | null;
}) {
  return null;
}
