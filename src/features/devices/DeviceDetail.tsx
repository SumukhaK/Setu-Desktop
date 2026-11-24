import { useState } from "react";

import { connectMessage, forgetMessage } from "./devicesPort";
import type { DeviceRow, DevicesPort } from "./devicesPort";

const FORGET_COPY =
  "Forget this device on this computer? This removes the saved pairing here. It does not revoke access on the phone. To end access now, use Disconnect, or End on the phone.";

export function DeviceDetail({
  device,
  connected,
  port,
  onChanged,
}: {
  device: DeviceRow;
  connected: boolean;
  port: DevicesPort;
  onChanged: () => void;
}) {
  const [nickname, setNickname] = useState(device.nickname ?? "");
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);

  async function save() {
    setNicknameError(null);
    try {
      const outcome = await port.setNickname(device.device_id, nickname);
      if (outcome.outcome === "saved") {
        onChanged();
      } else if (outcome.outcome === "invalid") {
        setNicknameError("Use 1–40 characters, or leave it empty to remove the nickname.");
      } else {
        setNicknameError("Couldn't save this nickname. Try again.");
      }
    } catch {
      setNicknameError("Couldn't save this nickname. Try again.");
    }
  }

  async function connect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const outcome = await port.connect(device.device_id);
      if (outcome.outcome === "connected") {
        onChanged();
      } else {
        setConnectError(connectMessage(outcome));
      }
    } catch {
      setConnectError("Couldn't connect. Try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function forget() {
    setForgetting(true);
    setForgetError(null);
    try {
      const outcome = await port.forget(device.device_id);
      if (outcome.outcome === "forgotten" || outcome.outcome === "not_paired") {
        onChanged();
      } else {
        setForgetError(forgetMessage(outcome));
      }
    } catch {
      setForgetError("Couldn't forget this device. Try again.");
    } finally {
      setForgetting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="card device-detail">
      <h3>{device.device_id}</h3>
      <label>
        Nickname
        <input
          value={nickname}
          onChange={(event) => {
            setNickname(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          void save();
        }}
      >
        Save
      </button>
      {nicknameError !== null && (
        <p role="alert" className="notice">
          {nicknameError}
        </p>
      )}

      {connected ? (
        <p>Connected</p>
      ) : connecting ? (
        <>
          <p>Connecting…</p>
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              void port.cancelConnect();
            }}
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className="button primary"
          onClick={() => {
            void connect();
          }}
        >
          Connect
        </button>
      )}
      {connectError !== null && (
        <p role="alert" className="notice">
          {connectError}
        </p>
      )}

      {!confirming && (
        <button
          type="button"
          className="button quiet danger"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Forget device
        </button>
      )}
      {confirming && (
        <>
          <p>{FORGET_COPY}</p>
          <button
            type="button"
            className="button primary danger-fill"
            disabled={forgetting}
            onClick={() => {
              void forget();
            }}
          >
            Forget
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Keep
          </button>
        </>
      )}
      {forgetError !== null && (
        <p role="alert" className="notice">
          {forgetError}
        </p>
      )}
    </div>
  );
}
