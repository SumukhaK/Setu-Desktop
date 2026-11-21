import { useEffect, useReducer } from "react";

import type { Clock } from "./clock";
import { initialState, reduce } from "./sessionStore";
import type { HubMessage, SessionStoreState } from "./sessionStore";

export interface SessionHubPort {
  subscribe(onMessage: (message: HubMessage) => void): Promise<() => void>;
  resync(): Promise<void>;
}

interface Action {
  message: HubMessage;
  at: number;
}

export function useSessions(port: SessionHubPort, clock: Clock): SessionStoreState {
  const [state, dispatch] = useReducer(
    (current: SessionStoreState, action: Action) => reduce(current, action.message, action.at),
    initialState,
  );

  useEffect(() => {
    // One lifecycle per effect run: a stale run must never apply to the next.
    const lifecycle: { active: boolean; unsubscribe: (() => void) | null } = {
      active: true,
      unsubscribe: null,
    };

    void (async () => {
      try {
        const stop = await port.subscribe((message) => {
          if (lifecycle.active) {
            dispatch({ message, at: clock.now() });
          }
        });
        if (!lifecycle.active) {
          stop();
          return;
        }
        lifecycle.unsubscribe = stop;
        await port.resync();
      } catch {
        // A failed subscription or resync leaves the store at its last state.
      }
    })();

    return () => {
      lifecycle.active = false;
      if (lifecycle.unsubscribe !== null) {
        lifecycle.unsubscribe();
      }
    };
  }, [port, clock]);

  return state;
}
