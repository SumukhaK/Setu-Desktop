import { useEffect, useRef, useState } from "react";

import { parseCodeInput } from "./codeFormat";
import { outcomeMessage } from "./pairPort";
import type { ConnectOutcome, PairPort } from "./pairPort";

export function PairDialog({
  port,
  draft,
  onDraftChange,
  onClose,
}: {
  port: PairPort;
  draft: string;
  onDraftChange: (value: string) => void;
  onClose: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const parsed = parseCodeInput(draft);
  const canConnect = parsed.code !== null && !connecting;
  // Unmounting with a connect still in flight cancels it, exactly like the
  // Cancel button; a settled connect must not be cancelled on its way out.
  const settled = useRef(false);

  useEffect(() => {
    if (!connecting) {
      return;
    }
    return () => {
      if (!settled.current) {
        void port.cancel();
      }
    };
  }, [connecting, port]);

  async function connect() {
    const code = parsed.code;
    if (code === null || connecting) {
      return;
    }
    setMessage(null);
    settled.current = false;
    setConnecting(true);
    try {
      const outcome: ConnectOutcome = await port.connect(code);
      settled.current = true;
      if (outcome.outcome === "connected" || outcome.outcome === "cancelled") {
        onClose();
        return;
      }
      setMessage(outcomeMessage(outcome));
    } catch {
      settled.current = true;
      setMessage("Couldn't reach the Setu service. Try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function cancel() {
    if (!connecting) {
      onClose();
      return;
    }
    await port.cancel();
  }

  return (
    <div role="dialog" aria-labelledby="pair-title" className="dialog">
      <div className="dialog-head">
        <h2 id="pair-title">Pair new device</h2>
      </div>
      <div className="dialog-body">
        <label htmlFor="pair-code">Pairing code</label>
        <input
          id="pair-code"
          value={parsed.display}
          onChange={(event) => {
            onDraftChange(event.target.value);
            setMessage(null);
          }}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={connecting}
          aria-invalid={parsed.problem !== null}
        />
        {parsed.problem !== null && (
          <p className="notice">Use only the 10 digits shown on the phone.</p>
        )}
        {message !== null && (
          <p role="alert" className="notice">
            {message}
          </p>
        )}
        {connecting && <p>Connecting…</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="button primary"
            disabled={!canConnect}
            onClick={() => {
              void connect();
            }}
          >
            Connect
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              void cancel();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
