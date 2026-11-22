import type { ConnectOutcome } from "../pair/pairPort";
import { outcomeMessage } from "../pair/pairPort";

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

const NOT_READY = "The Setu service isn't ready yet. Try again in a moment.";

export function listMessage(outcome: ListOutcome): string | null {
  switch (outcome.outcome) {
    case "listed":
      return null;
    case "not_ready":
      return NOT_READY;
    case "failed":
      return outcome.code === null
        ? "Couldn't load saved devices."
        : `Couldn't load saved devices (error ${String(outcome.code)}).`;
  }
}

export function forgetMessage(outcome: ForgetOutcome): string | null {
  switch (outcome.outcome) {
    case "forgotten":
      return null;
    case "not_paired":
      return "This device was already forgotten.";
    case "not_ready":
      return NOT_READY;
    case "invalid":
      return "This device can't be forgotten.";
    case "failed":
      return `Couldn't forget this device (error ${String(outcome.code)}). Try again.`;
  }
}

export function connectMessage(outcome: ConnectOutcome): string | null {
  switch (outcome.outcome) {
    case "connected":
    case "cancelled":
      return null;
    case "not_ready":
      return NOT_READY;
    case "unavailable":
      return "The phone is offline or can't be reached. Check that Setu is hosting on it.";
    case "not_paired":
      return "This device isn't paired any more. Pair it again with a new code.";
    case "revoked":
      return "Access to this device was revoked.";
    case "already_pending":
      return "Another connection is already in progress.";
    default:
      return outcomeMessage(outcome);
  }
}
