import { DeviceList } from "../features/devices/DeviceList";
import type { DevicesPort } from "../features/devices/devicesPort";

export function DevicesPage({
  port,
  liveDeviceIds,
}: {
  port: DevicesPort;
  liveDeviceIds: readonly string[];
}) {
  return (
    <>
      <header className="page-heading">
        <div>
          <h1 tabIndex={-1}>Devices</h1>
          <p>Paired phones on this computer</p>
        </div>
      </header>
      <DeviceList port={port} liveDeviceIds={liveDeviceIds} />
    </>
  );
}
