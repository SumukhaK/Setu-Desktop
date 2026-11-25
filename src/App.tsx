import { useCallback, useEffect, useRef, useState } from "react";

import { DevicesPage } from "./app/DevicesPage";
import { QuitConfirm } from "./app/QuitConfirm";
import { Shell } from "./app/Shell";
import type { Page } from "./app/Shell";
import { WorkspacePage } from "./app/WorkspacePage";
import type { WindowPort } from "./app/windowLifecycle";
import type { DaemonPort } from "./daemon/status";
import type { AdbPort } from "./features/adb/adbStatus";
import { useAdbStatus } from "./features/adb/useAdbStatus";
import type { DevicesPort } from "./features/devices/devicesPort";
import type { PairPort } from "./features/pair/pairPort";
import type { SessionPort } from "./features/session/sessionPort";
import { systemClock } from "./state/clock";
import type { Clock } from "./state/clock";
import { useSessions } from "./state/useSessions";
import type { SessionHubPort } from "./state/useSessions";

const noSessionPort: SessionPort = {
  stop: () => Promise.resolve({ outcome: "not_ready" }),
};
const noClipboard = { writeText: () => Promise.resolve() };

export function App({
  port,
  hubPort,
  pairPort,
  adbPort,
  sessionPort,
  clipboard,
  clock = systemClock,
  devicesPort,
  windowPort,
}: {
  port: DaemonPort;
  hubPort: SessionHubPort;
  pairPort?: PairPort;
  adbPort?: AdbPort;
  sessionPort?: SessionPort;
  clipboard?: { writeText(s: string): Promise<void> };
  clock?: Clock;
  devicesPort?: DevicesPort;
  windowPort?: WindowPort;
}) {
  const stopPort = sessionPort ?? noSessionPort;
  const targetClipboard = clipboard ?? noClipboard;
  const sessions = useSessions(hubPort, clock);
  const adb = useAdbStatus(adbPort ?? null);
  const [pairing, setPairing] = useState(false);
  const [page, setPage] = useState<Page>("workspace");
  const [dismissedEnded, setDismissedEnded] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [quitRequested, setQuitRequested] = useState(false);
  const [quitError, setQuitError] = useState(false);
  const [pairDraft, setPairDraft] = useState("");
  const quitStarted = useRef(false);
  const live = Object.values(sessions.live);
  const endedNotices = sessions.ended.filter(
    (session) =>
      session.reason !== "closed" &&
      !dismissedEnded.has(session.sessionId) &&
      (session.deviceId === null || !live.some((active) => active.deviceId === session.deviceId)),
  );

  useEffect(() => {
    if (windowPort === undefined) {
      return;
    }
    const lifecycle: { active: boolean; unsubscribe: (() => void) | null } = {
      active: true,
      unsubscribe: null,
    };
    void windowPort
      .onQuitRequested(() => {
        if (lifecycle.active) {
          // A fresh quit request dismisses a stale failure alert.
          setQuitError(false);
          setQuitRequested(true);
        }
      })
      .then((stop) => {
        if (lifecycle.active) {
          lifecycle.unsubscribe = stop;
        } else {
          stop();
        }
      })
      .catch(() => undefined);
    return () => {
      lifecycle.active = false;
      if (lifecycle.unsubscribe !== null) {
        lifecycle.unsubscribe();
      }
    };
  }, [windowPort]);

  // A rejected `app_quit` resets the guard so Quit can be retried, hides the
  // confirm and shows the failure alert (UK-04).
  const attemptQuit = useCallback(() => {
    if (windowPort === undefined || quitStarted.current) {
      return;
    }
    quitStarted.current = true;
    void windowPort.quit().catch(() => {
      quitStarted.current = false;
      setQuitRequested(false);
      setQuitError(true);
    });
  }, [windowPort]);

  useEffect(() => {
    if (!quitRequested || live.length !== 0) {
      return;
    }
    attemptQuit();
  }, [windowPort, quitRequested, live.length, attemptQuit]);

  return (
    <Shell
      page={page}
      onNavigate={setPage}
      items={devicesPort === undefined ? ["workspace"] : ["workspace", "devices"]}
    >
      {quitError && (
        <p role="alert" className="notice">
          Couldn't quit Setu. Try again.
        </p>
      )}
      {quitRequested && live.length > 0 && (
        <QuitConfirm
          count={live.length}
          onQuit={attemptQuit}
          onCancel={() => {
            setQuitRequested(false);
          }}
        />
      )}
      {page === "workspace" ? (
        <WorkspacePage
          port={port}
          sessions={live}
          adb={adb}
          clock={clock}
          adbPort={adbPort ?? null}
          sessionPort={stopPort}
          clipboard={targetClipboard}
          pairPort={pairPort}
          pairing={pairing}
          onPair={() => {
            setPairing(true);
          }}
          onPairingClose={() => {
            setPairing(false);
            setPairDraft("");
          }}
          pairDraft={pairDraft}
          onPairDraftChange={setPairDraft}
          ended={endedNotices}
          onDismissEnded={(sessionId) => {
            setDismissedEnded((current) => new Set(current).add(sessionId));
          }}
          reconnect={devicesPort === undefined ? undefined : devicesPort.connect.bind(devicesPort)}
          onMoveToTray={
            windowPort === undefined
              ? undefined
              : () => {
                  void windowPort.hide();
                }
          }
        />
      ) : devicesPort !== undefined ? (
        <DevicesPage port={devicesPort} liveDeviceIds={live.map((session) => session.deviceId)} />
      ) : null}
    </Shell>
  );
}
