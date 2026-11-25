import { useState } from "react";

import type { LiveSession } from "../../state/sessionStore";
import { attachmentLabel, attachmentOf, connectMessage } from "./adbStatus";
import type { AdbConnectOutcome, AdbPort, AdbSnapshot } from "./adbStatus";

export function SessionAdbLine({
  session,
  adb,
  port,
  onPairDebugger,
}: {
  session: LiveSession;
  adb: AdbSnapshot | null;
  port: AdbPort | null;
  onPairDebugger?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<AdbConnectOutcome | null>(null);
  const attachment = attachmentOf(session.adbAddr, adb);
  const showConnect =
    port !== null &&
    session.adbAddr !== null &&
    attachment !== "attached" &&
    attachment !== "unknown" &&
    attachment !== "server_down";
  const message = outcome === null ? null : connectMessage(outcome);

  async function connect() {
    if (port === null || session.adbAddr === null) {
      return;
    }
    setPending(true);
    setOutcome(null);
    try {
      setOutcome(await port.connect(session.adbAddr));
    } catch {
      // Keep the last state; the watcher remains the source of truth.
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="session-adb">
      <p>{`${session.adbAddr ?? "Address pending"} · ${attachmentLabel(attachment)}`}</p>
      {showConnect && (
        <button
          type="button"
          className="button primary"
          disabled={pending}
          onClick={() => {
            void connect();
          }}
        >
          Connect ADB
        </button>
      )}
      {onPairDebugger !== undefined && attachment !== "attached" && (
        <button type="button" className="button secondary" onClick={onPairDebugger}>
          Pair debugger
        </button>
      )}
      {message !== null && (
        <p role="alert" className="notice">
          {message}
        </p>
      )}
    </div>
  );
}
