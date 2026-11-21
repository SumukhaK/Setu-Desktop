import type { Clock } from "./clock";
import { initialState } from "./sessionStore";
import type { HubMessage, SessionStoreState } from "./sessionStore";

export interface SessionHubPort {
  subscribe(onMessage: (message: HubMessage) => void): Promise<() => void>;
  resync(): Promise<void>;
}

export function useSessions(_port: SessionHubPort, _clock: Clock): SessionStoreState {
  return initialState;
}
