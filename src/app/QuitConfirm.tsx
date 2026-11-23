import { useEffect, useRef, useState } from "react";

export function QuitConfirm({
  count,
  onQuit,
  onCancel,
}: {
  count: number;
  onQuit: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const started = useRef(false);
  const [quitting, setQuitting] = useState(false);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !started.current) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  const quit = (): void => {
    if (started.current) {
      return;
    }
    started.current = true;
    setQuitting(true);
    onQuit();
  };

  const line = `${String(count)} live session${count === 1 ? "" : "s"} will end.`;

  return (
    <div
      role="alertdialog"
      aria-labelledby="quit-title"
      aria-describedby="quit-body"
      className="dialog"
    >
      <div className="dialog-head">
        <h2 id="quit-title">Quit Setu?</h2>
      </div>
      <div className="dialog-body">
        <p id="quit-body">{`${line} Setu stops the local service on this computer.`}</p>
        <div className="dialog-actions">
          <button
            type="button"
            className="button primary danger"
            disabled={quitting}
            onClick={quit}
          >
            {quitting ? "Quitting…" : "Quit"}
          </button>
          <button ref={cancel} type="button" className="button quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
