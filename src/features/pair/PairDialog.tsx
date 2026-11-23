import { useState } from "react";

import { parseCodeInput } from "./codeFormat";
import { outcomeMessage } from "./pairPort";
import type { ConnectOutcome, PairPort } from "./pairPort";

export function PairDialog({ port, onClose }: { port: PairPort; onClose: () => void }) {
  const [raw, setRaw] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const parsed = parseCodeInput(raw);
  const canConnect = parsed.code !== null && !connecting;

  async function connect() {
    const code = parsed.code;
    if (code === null || connecting) {
      return;
    }
    setMessage(null);
    setConnecting(true);
    const outcome: ConnectOutcome = await port.connect(code);
    setConnecting(false);
    if (outcome.outcome === "connected" || outcome.outcome === "cancelled") {
      onClose();
      return;
    }
    setMessage(outcomeMessage(outcome));
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
            setRaw(event.target.value);
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
