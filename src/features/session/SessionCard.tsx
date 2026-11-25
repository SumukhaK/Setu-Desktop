import { useState } from "react";

import type { Clock } from "../../state/clock";
import type { LiveSession } from "../../state/sessionStore";
import { SessionAdbLine } from "../adb/SessionAdbLine";
import { attachmentOf } from "../adb/adbStatus";
import type { AdbPort, AdbSnapshot } from "../adb/adbStatus";
import { PairAdbDialog } from "../pair-adb/PairAdbDialog";
import type { PairAdbPort } from "../pair-adb/pairAdbPort";
import { RejoinBanner } from "./RejoinBanner";
import { StatusStrip } from "./StatusStrip";
import { stopMessage } from "./sessionPort";
import type { SessionPort, StopOutcome } from "./sessionPort";

export function SessionCard({
  session,
  adb,
  clock,
  adbPort,
  sessionPort,
  clipboard,
  pairAdbPort,
}: {
  session: LiveSession;
  adb: AdbSnapshot | null;
  clock: Clock;
  adbPort: AdbPort | null;
  sessionPort: SessionPort;
  clipboard: { writeText(s: string): Promise<void> };
  pairAdbPort?: PairAdbPort;
}) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<StopOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const [pairingDebugger, setPairingDebugger] = useState(false);
  const [debuggerPaired, setDebuggerPaired] = useState(false);
  const headingId = `session-${session.sessionId}`;
  const message = outcome === null ? null : stopMessage(outcome);

  async function disconnect() {
    setPending(true);
    setOutcome(null);
    try {
      setOutcome(await sessionPort.stop(session.sessionId));
    } catch {
      // Keep the last state; the session list is the source of truth.
    } finally {
      setPending(false);
    }
  }

  async function copyAddress() {
    if (session.adbAddr === null) {
      return;
    }
    try {
      await clipboard.writeText(session.adbAddr);
      setCopied(true);
    } catch {
      // A failed copy leaves the previous state unchanged.
    }
  }

  return (
    <article aria-labelledby={headingId} className="card session-card">
      <h2 id={headingId}>{session.deviceId}</h2>
      <RejoinBanner session={session} adb={adb} clock={clock} />
      <StatusStrip session={session} adb={adb} />
      <SessionAdbLine
        session={session}
        adb={adb}
        port={adbPort}
        onPairDebugger={
          pairAdbPort === undefined
            ? undefined
            : () => {
                setPairingDebugger(true);
              }
        }
      />
      {debuggerPaired && attachmentOf(session.adbAddr, adb) !== "attached" && (
        <p role="status">Debugger paired. Use Connect ADB to attach.</p>
      )}
      {pairAdbPort !== undefined && pairingDebugger && (
        <PairAdbDialog
          deviceId={session.deviceId}
          port={pairAdbPort}
          onClose={() => {
            setPairingDebugger(false);
          }}
          onPaired={() => {
            setPairingDebugger(false);
            setDebuggerPaired(true);
          }}
        />
      )}
      <div className="session-actions">
        {session.adbAddr !== null && (
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              void copyAddress();
            }}
          >
            Copy address
          </button>
        )}
        {copied && <p>Copied</p>}
        <button
          type="button"
          className="button quiet danger"
          disabled={pending}
          onClick={() => {
            void disconnect();
          }}
        >
          Disconnect
        </button>
        {message !== null && (
          <p role="alert" className="notice">
            {message}
          </p>
        )}
      </div>
    </article>
  );
}
