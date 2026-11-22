import type { DeviceRow, DevicesPort } from "./devicesPort";

export function DeviceDetail(_props: {
  device: DeviceRow;
  connected: boolean;
  port: DevicesPort;
  onChanged(): void;
}) {
  return <div />;
}
