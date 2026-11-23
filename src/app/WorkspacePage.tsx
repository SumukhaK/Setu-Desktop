import { StatusStrip } from "../daemon/StatusStrip";
import type { DaemonPort } from "../daemon/status";
import type { AdbPort, AdbSnapshot } from "../features/adb/adbStatus";
import { PairDialog } from "../features/pair/PairDialog";
import type { ConnectOutcome, PairPort } from "../features/pair/pairPort";
import { EndedNotice } from "../features/session/EndedNotice";
import { SessionCard } from "../features/session/SessionCard";
import type { SessionPort } from "../features/session/sessionPort";
import type { Clock } from "../state/clock";
import type { EndedSession, LiveSession } from "../state/sessionStore";
import { Icon } from "./Icon";

// EndedNotice only calls reconnect when Reconnect is visible, which requires
// a devices port. This placeholder keeps the single required prop without
// inventing a second "no port" state inside the component.
const noReconnect = (): Promise<ConnectOutcome> => Promise.resolve({ outcome: "cancelled" });

export function WorkspacePage({
  port,
  sessions,
  adb,
  clock,
  adbPort,
  sessionPort,
  clipboard,
  pairPort,
  pairing,
  onPair,
  onPairingClose,
  ended,
  onDismissEnded,
  reconnect,
  onMoveToTray,
}: {
  port: DaemonPort;
  sessions: readonly LiveSession[];
  adb: AdbSnapshot | null;
  clock: Clock;
  adbPort: AdbPort | null;
  sessionPort: SessionPort;
  clipboard: { writeText(s: string): Promise<void> };
  pairPort?: PairPort;
  pairing: boolean;
  onPair: () => void;
  onPairingClose: () => void;
  ended: readonly EndedSession[];
  onDismissEnded: (sessionId: string) => void;
  reconnect?: (deviceId: string) => Promise<ConnectOutcome>;
  onMoveToTray?: () => void;
}) {
  const count = sessions.length;
  const line =
    count === 0 ? "No live sessions" : `${String(count)} live session${count === 1 ? "" : "s"}`;

  return (
    <>
      <header className="page-heading">
        <div>
          <h1 tabIndex={-1}>Workspace</h1>
          <p>This computer · Solo · Local-first</p>
        </div>
        {onMoveToTray !== undefined && (
          <button type="button" className="button secondary" onClick={onMoveToTray}>
            Move to tray
          </button>
        )}
      </header>
      <StatusStrip port={port} />
      <p>{line}</p>
      {ended.map((session) => (
        <EndedNotice
          key={session.sessionId}
          ended={session}
          canReconnect={reconnect !== undefined && session.deviceId !== null}
          reconnect={reconnect ?? noReconnect}
          onDismiss={onDismissEnded}
        />
      ))}
      {sessions.map((session) => (
        <SessionCard
          key={session.sessionId}
          session={session}
          adb={adb}
          clock={clock}
          adbPort={adbPort}
          sessionPort={sessionPort}
          clipboard={clipboard}
        />
      ))}
      {pairPort !== undefined && (
        <>
          <button type="button" className="button primary" onClick={onPair}>
            <Icon name="plus" />
            Pair new device
          </button>
          {pairing && <PairDialog port={pairPort} onClose={onPairingClose} />}
        </>
      )}
    </>
  );
}
