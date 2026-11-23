import { useCallback, useEffect, useRef, useState } from "react";

import { DeviceDetail } from "./DeviceDetail";
import { listMessage } from "./devicesPort";
import type { DeviceRow, DevicesPort } from "./devicesPort";

export function DeviceList({
  port,
  liveDeviceIds,
}: {
  port: DevicesPort;
  liveDeviceIds: readonly string[];
}) {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const request = useRef(0);
  const liveKey = [...liveDeviceIds].sort().join("\u0000");

  const load = useCallback(async () => {
    const current = ++request.current;
    const outcome = await port.list();
    if (current !== request.current) {
      return;
    }
    if (outcome.outcome !== "listed") {
      setMessage(listMessage(outcome));
      return;
    }
    setDevices(outcome.devices);
    setMessage(null);
    setSelected((previous) =>
      outcome.devices.some((device) => device.device_id === previous) ? previous : null,
    );
  }, [port]);

  useEffect(() => {
    // Defer through a microtask so an async list never synchronously sets
    // state inside the effect body.
    void Promise.resolve().then(() => {
      void load();
    });
  }, [load, liveKey]);

  const changed = useCallback(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="saved-devices-heading" className="card device-card">
      <h2 id="saved-devices-heading">Saved devices</h2>
      {message !== null && (
        <>
          <p role="alert" className="notice">
            {message}
          </p>
          <button type="button" className="button secondary" onClick={changed}>
            Refresh
          </button>
        </>
      )}
      {devices.length === 0 && message === null && (
        <p className="device-empty">No saved devices yet. Pair a phone to add it.</p>
      )}
      <div className="list">
        {devices.map((device) => (
          <div key={device.device_id}>
            <button
              type="button"
              className="list-row"
              onClick={() => {
                setSelected(device.device_id);
              }}
            >
              {device.nickname !== null
                ? `${device.nickname} · ${device.device_id} · Presence unknown`
                : `${device.device_id} · Presence unknown`}
            </button>
            {selected === device.device_id && (
              <DeviceDetail
                device={device}
                connected={liveDeviceIds.includes(device.device_id)}
                port={port}
                onChanged={changed}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
