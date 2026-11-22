import type { ConnectOutcome } from "../pair/pairPort";

export interface DeviceRow {
  device_id: string;
  paired: boolean;
  source: string;
  nickname: string | null;
}

export type ListOutcome =
  | { outcome: "listed"; devices: DeviceRow[] }
  | { outcome: "not_ready" }
  | { outcome: "failed"; code: number | null };

export type ForgetOutcome =
  | { outcome: "forgotten" }
  | { outcome: "not_paired" }
  | { outcome: "not_ready" }
  | { outcome: "invalid" }
  | { outcome: "failed"; code: number | null };

export type NicknameOutcome =
  { outcome: "saved"; nickname: string | null } | { outcome: "invalid" } | { outcome: "failed" };

export interface DevicesPort {
  list(): Promise<ListOutcome>;
  forget(deviceId: string): Promise<ForgetOutcome>;
  setNickname(deviceId: string, nickname: string): Promise<NicknameOutcome>;
  connect(deviceId: string): Promise<ConnectOutcome>;
  cancelConnect(): Promise<boolean>;
}

export function listMessage(_outcome: ListOutcome): string | null {
  return null;
}

export function forgetMessage(_outcome: ForgetOutcome): string | null {
  return null;
}

export function connectMessage(_outcome: ConnectOutcome): string | null {
  return null;
}
