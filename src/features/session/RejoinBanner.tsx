import type { Clock } from "../../state/clock";
import type { LiveSession } from "../../state/sessionStore";
import type { AdbSnapshot } from "../adb/adbStatus";

export function RejoinBanner(_props: {
  session: LiveSession;
  adb: AdbSnapshot | null;
  clock: Clock;
}) {
  return null;
}
