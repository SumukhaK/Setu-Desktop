import type { LiveSession } from "../../state/sessionStore";
import type { AdbSnapshot } from "../adb/adbStatus";

export function StatusStrip(_props: { session: LiveSession; adb: AdbSnapshot | null }) {
  return <ul aria-label="Session status" />;
}
