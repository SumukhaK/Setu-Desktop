import { useEffect, useRef, useState } from "react";

import { pairAdbMessage, parseAdbPairInput } from "./pairAdbPort";
import type { PairAdbOutcome, PairAdbPort } from "./pairAdbPort";

export function PairAdbDialog({
  deviceId,
  port,
  onClose,
  onPaired,
}: {
  deviceId: string;
  port: PairAdbPort;
  onClose: () => void;
  onPaired: () => void;
}) {
  const [code, setCode] = useState("");
  const [pairingPort, setPairingPort] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const settled = useRef(false);

  useEffect(() => {
    if (!pending) {
      return;
    }
    return () => {
      if (!settled.current) {
        void port.cancel();
      }
    };
  }, [pending, port]);

  async function pair() {
    if (inFlight.current) {
      return;
    }
    const parsed = parseAdbPairInput(code, pairingPort);
    if (parsed === null) {
      setMessage(pairAdbMessage({ outcome: "malformed" }));
      return;
    }
    inFlight.current = true;
    settled.current = false;
    setPending(true);
    setMessage(null);
    try {
      const outcome: PairAdbOutcome = await port.pair(deviceId, parsed.code, parsed.port);
      settled.current = true;
      if (outcome.outcome === "paired") {
        onPaired();
        return;
      }
      if (outcome.outcome === "cancelled") {
        onClose();
        return;
      }
      if (outcome.outcome === "pair_failed") {
        setCode("");
      }
      setMessage(pairAdbMessage(outcome));
    } catch {
      settled.current = true;
      setMessage("Couldn't reach the Setu service. Try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div role="dialog" aria-labelledby="pair-adb-title" className="dialog">
      <div className="dialog-head">
        <h2 id="pair-adb-title">Pair debugger (Android 11+)</h2>
      </div>
      <div className="dialog-body">
        <p>
          On the phone, open Settings › Developer options › Wireless debugging › Pair device with
          pairing code.
        </p>
        <label htmlFor="pair-adb-code">Pairing code</label>
        <input
          id="pair-adb-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setMessage(null);
          }}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
        />
        <label htmlFor="pair-adb-port">Port (optional)</label>
        <input
          id="pair-adb-port"
          value={pairingPort}
          onChange={(event) => {
            setPairingPort(event.target.value);
            setMessage(null);
          }}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
        />
        {message !== null && (
          <p role="alert" className="notice">
            {message}
          </p>
        )}
        {pending && <p>Pairing…</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="button primary"
            disabled={pending}
            onClick={() => {
              void pair();
            }}
          >
            Pair
          </button>
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              if (pending) {
                void port.cancel();
              } else {
                onClose();
              }
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
