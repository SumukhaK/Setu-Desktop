import { useRef, useState } from "react";

import type { EndedSession } from "../../state/sessionStore";
import { connectMessage } from "../devices/devicesPort";
import type { ConnectOutcome } from "../pair/pairPort";

const UNREACHABLE = "Couldn't reach the Setu service. Try again.";

function sentenceOf(ended: EndedSession): string | null {
  switch (ended.reason) {
    case "closed":
      return null;
    case "peer_closed":
      return ended.peerReason === null
        ? "The session was ended on the phone."
        : `The session was ended on the phone. Reason: ${ended.peerReason}`;
    case "session_expired":
      return "The session time limit was reached.";
    case "error":
      return "The connection to the phone ended unexpectedly.";
  }
}

export function EndedNotice({
  ended,
  canReconnect,
  reconnect,
  onDismiss,
}: {
  ended: EndedSession;
  canReconnect: boolean;
  reconnect: (deviceId: string) => Promise<ConnectOutcome>;
  onDismiss: (sessionId: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const sentence = sentenceOf(ended);

  if (sentence === null) {
    return null;
  }

  const handleReconnect = (): void => {
    if (inFlight.current || ended.deviceId === null) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    void reconnect(ended.deviceId).then(
      (outcome) => {
        inFlight.current = false;
        setPending(false);
        if (outcome.outcome !== "connected") {
          setMessage(connectMessage(outcome));
        }
      },
      () => {
        inFlight.current = false;
        setPending(false);
        setMessage(UNREACHABLE);
      },
    );
  };

  return (
    <div role="alert" className="notice warning">
      <div>
        <p>{sentence}</p>
        {message !== null && <p>{message}</p>}
      </div>
      {canReconnect && ended.deviceId !== null && (
        <button
          type="button"
          className="button primary"
          disabled={pending}
          onClick={handleReconnect}
        >
          {pending ? "Reconnecting…" : "Reconnect"}
        </button>
      )}
      <button
        type="button"
        className="button quiet"
        onClick={() => {
          onDismiss(ended.sessionId);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
