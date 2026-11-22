import { useEffect, useState } from "react";

import type { AdbPort, AdbSnapshot } from "./adbStatus";

/**
 * Follow the local ADB snapshot. Subscribing happens before the initial
 * `current()` read, and a pushed value always wins over a late read.
 */
export function useAdbStatus(port: AdbPort | null): AdbSnapshot | null {
  const [snapshot, setSnapshot] = useState<AdbSnapshot | null>(null);

  useEffect(() => {
    if (port === null) {
      return;
    }
    const lifecycle: { active: boolean; unsubscribe: (() => void) | null } = {
      active: true,
      unsubscribe: null,
    };

    void (async () => {
      try {
        const stop = await port.subscribe((next) => {
          if (lifecycle.active) {
            setSnapshot(next);
          }
        });
        if (!lifecycle.active) {
          stop();
          return;
        }
        lifecycle.unsubscribe = stop;
      } catch {
        // A failed subscription leaves the last snapshot in place.
      }

      try {
        const current = await port.current();
        if (lifecycle.active) {
          setSnapshot((previous) => previous ?? current);
        }
      } catch {
        // A failed read leaves the last snapshot in place.
      }
    })();

    return () => {
      lifecycle.active = false;
      lifecycle.unsubscribe?.();
    };
  }, [port]);

  return snapshot;
}
