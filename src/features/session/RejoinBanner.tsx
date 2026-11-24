import { useEffect, useState } from "react";

import type { Clock } from "../../state/clock";
import type { LiveSession } from "../../state/sessionStore";
import { attachmentOf } from "../adb/adbStatus";
import type { AdbSnapshot } from "../adb/adbStatus";
import { nextWakeAt, rejoinViewOf } from "./rejoinMachine";

export function RejoinBanner({
  session,
  adb,
  clock,
}: {
  session: LiveSession;
  adb: AdbSnapshot | null;
  clock: Clock;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [tick, redraw] = useState(0);
  const view = rejoinViewOf(session, clock.now(), dismissed);

  // The only moment the view can change without an event is the 10 s holding
  // boundary. One timeout, cleared whenever the session's tunnels change. The
  // tick is a dependency, so a redraw that fires just short of the boundary
  // re-evaluates `nextWakeAt` and arms the missing last timer instead of
  // waiting for the next event (UK-04).
  useEffect(() => {
    const wake = nextWakeAt(session, clock.now());
    if (wake === null) {
      return;
    }
    const timer = setTimeout(
      () => {
        redraw((current) => current + 1);
      },
      Math.max(0, wake - clock.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [session, clock, tick]);

  if (view.kind === "holding") {
    const suffix =
      attachmentOf(session.adbAddr, adb) === "attached" ? " Local ADB is still attached." : "";
    return (
      <p role="status" className="notice warning">
        {`Phone connection interrupted. Setu is holding this session while it reconnects.${suffix}`}
      </p>
    );
  }

  if (view.kind === "lost") {
    return (
      <div role="alert" className="notice warning">
        <p>{"The phone is unreachable. ADB will need to reattach when it's back."}</p>
        <button
          type="button"
          className="button quiet"
          onClick={() => {
            setDismissed((current) => new Set(current).add(view.tunnelId));
          }}
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
