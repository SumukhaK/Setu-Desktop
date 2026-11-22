import type { DevicesPort } from "./devicesPort";

export function DeviceList(_props: { port: DevicesPort; liveDeviceIds: readonly string[] }) {
  return <section aria-labelledby="saved-devices-heading" />;
}
