import { useCallback, useEffect, useRef, useState } from "react";

import { checkLabel, reportText, statusView } from "./checks";
import type { DiagnosticsPort, DoctorOutcome, DoctorReport } from "./diagnosticsPort";

function errorMessage(outcome: Exclude<DoctorOutcome, { outcome: "report" }>): string {
  switch (outcome.outcome) {
    case "not_ready":
      return "The Setu service isn't ready yet. Try again in a moment.";
    case "timed_out":
      return "Diagnostics took too long. Try again.";
    case "failed":
      return outcome.code === null
        ? "Couldn't run diagnostics. Try again."
        : `Couldn't run diagnostics (error ${String(outcome.code)}). Try again.`;
  }
}

export function DiagnosticsPage({
  port,
  clipboard,
}: {
  port: DiagnosticsPort;
  clipboard: { writeText(s: string): Promise<void> };
}) {
  const [pending, setPending] = useState(true);
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const sequence = useRef(0);

  const run = useCallback(async () => {
    const current = ++sequence.current;
    setPending(true);
    setReport(null);
    setError(null);
    setCopied(false);
    try {
      const outcome = await port.run();
      if (current !== sequence.current) {
        return;
      }
      if (outcome.outcome === "report") {
        setReport(outcome);
      } else {
        setError(errorMessage(outcome));
      }
    } catch {
      if (current === sequence.current) {
        setError("Couldn't reach the Setu service. Try again.");
      }
    } finally {
      if (current === sequence.current) {
        setPending(false);
      }
    }
  }, [port]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        void run();
      }
    });
    return () => {
      active = false;
      // Any in-flight result belongs to the unmounted page.
      sequence.current += 1;
    };
  }, [run]);

  async function copy() {
    if (report === null) {
      return;
    }
    try {
      await clipboard.writeText(reportText(report));
      setCopied(true);
    } catch {
      // A failed clipboard write leaves the report on screen.
    }
  }

  return (
    <>
      <header className="page-heading">
        <div>
          <h1 tabIndex={-1}>Diagnostics</h1>
          <p>setu doctor · This computer</p>
        </div>
      </header>
      {pending && (
        <p className="notice" role="status">
          Checking local diagnostics…
        </p>
      )}
      {report !== null && (
        <section className="card standard-card">
          <h2>Doctor checks</h2>
          <p>{report.ok ? "All checks passed" : "Some checks failed"}</p>
          <p className="hint">{`${report.version} · ${report.platform}`}</p>
          <ul className="list">
            {report.checks.map((check, index) => {
              const view = statusView(check.status);
              return (
                <li key={`${check.name}-${String(index)}`}>
                  <div>
                    <strong>{checkLabel(check.name)}</strong> <code>{check.name}</code>
                    <p>{check.detail}</p>
                    {check.status !== "ok" && check.hint !== null && (
                      <p className="muted">{`Fix: ${check.hint}`}</p>
                    )}
                  </div>
                  <span className={`status ${view.tone}`}>
                    <span aria-hidden="true" />
                    {view.label}
                  </span>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={() => {
              void run();
            }}
          >
            Run again
          </button>
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              void copy();
            }}
          >
            Copy report
          </button>
          {copied && <p role="status">Report copied.</p>}
        </section>
      )}
      {error !== null && (
        <>
          <p className="notice warning" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={() => {
              void run();
            }}
          >
            Run again
          </button>
        </>
      )}
    </>
  );
}
