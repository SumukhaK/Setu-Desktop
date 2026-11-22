export type AdbSnapshot =
  | { server: "unknown" }
  | { server: "down" }
  | { server: "up"; devices: { serial: string; state: string }[] };

export type AdbConnectOutcome =
  | { outcome: "connected" }
  | { outcome: "not_loopback" }
  | { outcome: "missing" }
  | { outcome: "timed_out" }
  | { outcome: "failed"; detail: string };

export interface AdbPort {
  current(): Promise<AdbSnapshot>;
  subscribe(cb: (snapshot: AdbSnapshot) => void): Promise<() => void>;
  connect(adbAddr: string): Promise<AdbConnectOutcome>;
}

export type Attachment =
  "attached" | "unauthorized" | "offline" | "absent" | "server_down" | "unknown" | "other";

export function attachmentOf(adbAddr: string | null, snapshot: AdbSnapshot | null): Attachment {
  if (snapshot === null || snapshot.server === "unknown") {
    return "unknown";
  }
  if (snapshot.server === "down") {
    return "server_down";
  }
  if (adbAddr === null) {
    return "absent";
  }
  const device = snapshot.devices.find((candidate) => candidate.serial === adbAddr);
  if (device === undefined) {
    return "absent";
  }
  switch (device.state) {
    case "device":
      return "attached";
    case "unauthorized":
      return "unauthorized";
    case "offline":
      return "offline";
    default:
      return "other";
  }
}

export function attachmentLabel(attachment: Attachment): string {
  switch (attachment) {
    case "attached":
      return "ADB attached";
    case "unauthorized":
      return "Allow USB debugging on the phone";
    case "offline":
      return "ADB sees the phone offline. Try Connect ADB again.";
    case "absent":
      return "ADB not attached";
    case "server_down":
      return "ADB server isn't running";
    case "unknown":
      return "Checking ADB…";
    case "other":
      return "ADB is still connecting to the phone";
  }
}

export function connectMessage(outcome: AdbConnectOutcome): string | null {
  switch (outcome.outcome) {
    case "connected":
      return null;
    case "missing":
      return "Android Platform Tools (adb) weren't found. Install them or set SETU_ADB_PATH.";
    case "timed_out":
      return "adb connect didn't answer in 10 seconds. Try again.";
    case "not_loopback":
      return "Setu only connects ADB to this computer's loopback address.";
    case "failed":
      return `adb connect failed: ${outcome.detail}`;
  }
}
