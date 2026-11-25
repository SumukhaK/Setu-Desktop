# Builder prompt · DT-11 · Diagnostics

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-14).
2. `docs/TDD_TICKETS.md` §5 "DT-11" and §3 row P16.
3. `docs/JOURNEYS.md` J6 "Diagnostics" paragraph and row P16; `docs/SCREENS.md` row D09.
4. Setu-SDK v1.1.0 `API_SPEC.md` §1.7 (`DoctorReport`) and the `doctor` row in §2: https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
5. The prototype (visual reference only, never app code):
   - `prototype.js`: `checks` (the label list) and `doctorPage()`
   - `styles.css`: `.status`, `.status > span`, `.status.good`, `.status.warning`, `.status.critical`, `.standard-card*`, `.hint`, `.muted`
6. Existing code you'll use or extend:
   - `src-tauri/src/log/redact.rs` (DT-10), `src-tauri/src/app/mod.rs`
   - `src-tauri/tests/support/fake_daemon.rs`
   - `src/app/Shell.tsx` (`Page`, `navItems`, `items`), `src/App.tsx`, `src/platform/tauri.ts`, `src/main.tsx`, `src/styles/app.css`

**Facts this ticket relies on (read by the reviewer in the v1.1.0 source, `core/pkg/genadb/doctor.go`):**
- `doctor` takes no params and returns `{version, platform, ok, checks: [{name, status, detail, hint?}]}`. `hint` is omitted when empty. `ok` is false when any check is `fail`.
- `status` is one of `ok`, `warn`, `fail` or `skip` today. Treat any other string as unknown, not as an error.
- Checks today, in order:
  1. `adb`
  2. `state`
  3. `paired_devices`
  4. `proxy_env`
  5. either `relay` (skip, when no relay is configured) or `relay_dns` then `relay_reach`
  6. `audit_log`
  
  More may come later, and the UI must render any unknown name.
- The network checks use an 8 s timeout each, so one run can take about 20 s. `RpcClient::call` has no timeout of its own.
- The SDK already strips proxy credentials in `proxy_env`. Other details (DNS and dial errors, file paths, device ids) are free text. Rust redacts every string before it crosses the bridge.

## 1. Goal

A **Diagnostics** page in the rail runs the daemon's `doctor` and lists every check with its label, a status pill, the detail and the fix hint (P16).
- Unknown check names and statuses render generically.
- **Run again** re-runs the checks, and **Copy report** copies a plain-text report.
- No JWT, pairing code or proxy credential can appear on the page or in the copied text, because Rust redacts first.

Out of scope:
- The Settings page and its "Connection settings" link (DT-12).
- Audit log (DT-13).
- File export.
- Running checks on a schedule.

## 2. Files (create or change only these)

```
src-tauri/src/log/redact.rs                 + two rules (§3) and their unit tests
src-tauri/src/commands/diagnostics.rs       DoctorOutcome, run_doctor()
src-tauri/src/commands/mod.rs               pub mod diagnostics; re-exports
src-tauri/tests/diagnostics_commands.rs     FakeDaemon tests (§4)
src-tauri/src/app/mod.rs                    + command diagnostics_run
src/features/diagnostics/checks.ts          labels, statusView(), reportText()
src/features/diagnostics/checks.test.ts
src/features/diagnostics/diagnosticsPort.ts DoctorOutcome mirror, DiagnosticsPort
src/features/diagnostics/DiagnosticsPage.tsx (+ .test.tsx)
src/app/Shell.tsx (+ Shell.test.tsx)        Page += "diagnostics" (icon "terminal", label "Diagnostics")
src/App.tsx, src/App.test.tsx               optional diagnosticsPort, + rail item and page
src/platform/tauri.ts                       + tauriDiagnosticsPort
src/main.tsx                                pass diagnosticsPort
src/styles/app.css                          port .status, .status > span, .status.good/.warning/.critical, .standard-card (+ > .list, > .list > li), .hint, .muted
```

Don't touch `daemon/`, `rpc/`, `events/`, `adb/`, `store/`, the other `commands/*`, `capabilities/`, `tauri.conf.json`, `src/state/`, the other feature folders, `docs/`, `README.md`, the prototype or CI. Add no crate and no npm package.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Redaction (`log/redact.rs`).** Keep the three DT-10 rules. Append two more, applied after them:
4. **URL userinfo:** in any `scheme://user[:pass]@host`, replace everything between `://` and the last `@` that comes before the next `/`, whitespace or end with `[redacted]`. The result is `scheme://[redacted]@host`.
5. **JWT-shaped tokens:** `eyJ` followed by base64url characters, a `.`, base64url characters, a `.`, and optional base64url characters, becomes `[redacted-jwt]`. The token must not touch other base64url characters on either side.

Both rules are hand-scanned. Everything else passes through byte-for-byte.

**Command (`commands/diagnostics.rs`, no Tauri).**

```rust
#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct DoctorCheck { pub name: String, pub status: String, pub detail: String, pub hint: Option<String> }

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum DoctorOutcome {
    Report { version: String, platform: String, ok: bool, checks: Vec<DoctorCheck> },
    NotReady,
    TimedOut,
    Failed { code: Option<i64> },
}

pub async fn run_doctor(client: Option<RpcClient>, limit: Duration) -> DoctorOutcome;
```

- Call `doctor` with no params, wrapped in `tokio::time::timeout(limit, …)`. The shell passes 30 s.
- Parse it leniently:
  - a missing `hint` or an empty one becomes `None`
  - a missing `checks` becomes `[]`
  - a missing `version` or `platform` becomes `""`
  - a non-object result becomes `Failed { code: None }`
- Pass **every** string (name, status, detail, hint, version, platform) through `redact()` before building the outcome.
- `ok` comes from the daemon. Don't recompute it.
- Shell: `#[tauri::command] async fn diagnostics_run(..) -> Result<DoctorOutcome, String>` using `ready_client`.

**UI.**
- `checks.ts`:
  - `checkLabel(name)` returns:
    - `adb` → "Android Debug Bridge"
    - `state` → "State directory"
    - `paired_devices` → "Paired devices"
    - `proxy_env` → "Proxy environment"
    - `relay` → "Relay"
    - `relay_dns` → "Relay DNS"
    - `relay_reach` → "Relay reachability"
    - `audit_log` → "Audit log"
    - anything else → the raw name
  - `statusView(status)` returns `{ label, tone }`:
    - `ok` → `{ "OK", "good" }`
    - `warn` → `{ "Warning", "warning" }`
    - `fail` → `{ "Failed", "critical" }`
    - `skip` → `{ "Skipped", "neutral" }`
    - anything else → `{ status.toUpperCase() || "UNKNOWN", "neutral" }`
  - `reportText(report)`: a plain-text report, built only from the already-redacted report fields:
    - first line: `Setu doctor · {version} · {platform} · {ok ? "all checks passed" : "some checks failed"}`
    - then one line per check: `{label} ({name}): {statusLabel} · {detail}`
    - plus `  Fix: {hint}` when there's a hint
- `DiagnosticsPage` (props `{ port: DiagnosticsPort; clipboard: { writeText(s: string): Promise<void> } }`):
  - Heading: `<header className="page-heading">` with `<h1 tabIndex={-1}>Diagnostics</h1>` and subtitle "setu doctor · This computer".
  - Run `port.run()` once on mount. While pending, show `<p className="notice" role="status">Checking local diagnostics…</p>`.
  - **Report:** a `<section className="card standard-card">` holding:
    - `<h2>Doctor checks</h2>`
    - a summary line: "All checks passed", or "Some checks failed" when `!ok`
    - `<p className="hint">{version} · {platform}</p>`
    - `<ul className="list">` with one `<li>` per check, containing `<strong>{label}</strong> <code>{name}</code>`, `<p>{detail}</p>` and, when there's a hint and the status isn't `ok`, `<p className="muted">Fix: {hint}</p>`, plus `<span className={"status " + tone}><span aria-hidden="true"></span>{label}</span>`
    - buttons **Run again** (`button secondary`, disabled while pending) and **Copy report** (`button quiet`), which writes `reportText` to the clipboard and then shows "Report copied." in a `role="status"` line
  - **Errors:**
    - `not_ready` → "The Setu service isn't ready yet. Try again in a moment."
    - `timed_out` → "Diagnostics took too long. Try again."
    - `failed` → "Couldn't run diagnostics (error N). Try again.", or the same without the code
    - a rejection → "Couldn't reach the Setu service. Try again."
    
    Each shows in `<p className="notice warning" role="alert">`, with **Run again** still available.
  - A late result after unmount is ignored.
- `Shell`: `Page` gains `"diagnostics"`, with `navItems.diagnostics = { label: "Diagnostics", icon: "terminal" }`.
- `App`: optional `diagnosticsPort`. Add `"diagnostics"` to `items` after Devices when the port is given, and render `DiagnosticsPage` for that page, using the same clipboard App already has. `main.tsx` passes `tauriDiagnosticsPort`.
- CSS: port the listed prototype rules verbatim, apart from formatting. No inline styles.

## 4. TDD: write these tests first, see them fail, then implement

- **`redact.rs`:**
  - `http://alice:s3cret@proxy.corp:3128` → `http://[redacted]@proxy.corp:3128`
  - `wss://relay.example.com/x` is untouched
  - `user@example.com` (no `://`) is untouched
  - a 3-part `eyJhbGciOi…` token inside text → `[redacted-jwt]`
  - `eyJ` alone is untouched
  - all DT-10 cases still pass
- **`tests/diagnostics_commands.rs`** (FakeDaemon, every wait under `timeout`):
  - **A real-shaped report:** a request with method `doctor` and no params; the checks are kept in order; `hint` is absent for an empty hint.
  - **A detail containing `http://u:p@proxy:8080`, a `1234-567890` code and an `eyJa.eyJb.sig` token:** the outcome holds none of the secrets and does hold `[redacted]`.
  - **An unknown check** `{name:"future_check", status:"maybe", detail:"x"}` passes through unchanged.
  - **Missing `checks`** → an empty list.
  - **A non-object result** → `Failed{None}`.
  - **An error `-32603`** → `Failed{Some(-32603)}`.
  - **A `None` client** → `NotReady`.
  - **A daemon that never replies, with `limit` 200 ms** → `TimedOut`.
- **`checks.test.ts`:** each known label, the fallback for an unknown name, every `statusView` branch including an unknown status and an empty one, and the exact `reportText` lines, with and without a hint.
- **`DiagnosticsPage.test.tsx`:**
  - pending → the report renders
  - a `fail` check shows its detail and "Fix: …"; an `ok` check hides its hint
  - a future check and status render generically
  - **Run again** calls `run` a second time
  - **Copy report** writes exactly `reportText(...)`
  - each error branch shows its message
  - a late resolve after unmount doesn't throw or update
- **`Shell.test.tsx` / `App.test.tsx`:** the Diagnostics rail item appears only with a `diagnosticsPort`; clicking it focuses the "Diagnostics" `h1` and calls `run` once.

## 5. Gates (all must pass before you push)

From the repo root:

```
npm ci
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

From `src-tauri/`:

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

All three CI jobs (`gates-linux`, `gates-windows`, `e2e-linux`) must be green on the PR head. Use no `#[allow(...)]`, no `unwrap()` outside tests, no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no non-null `!`, and no inline styles.

**Manual check** (name the OS): run `npm run tauri dev` with a real daemon and open Diagnostics. Attach a screenshot of the page and paste the copied report. Set `HTTPS_PROXY=http://user:pass@127.0.0.1:9` before the run, and show that neither the page nor the copied text contains `user:pass`.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** Rust owns the RPC, the timeout and redaction. The UI only labels and lays out strings it already received redacted (AD-5, AD-9, AD-11).
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`, including how the redaction rules could over-mask, and why that's acceptable.
2. **Simplicity first.** One command, one page, one pure helpers file. No polling, no caching across page switches, no export file.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-11-diagnostics`, with atomic commits:
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first. Paste the red excerpt, the green gate output, the CI links and the manual check in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-11 diagnostics`, with this body:

```
Ticket: DT-11 (docs/TDD_TICKETS.md §5) · Acceptance: P16 (fail, skip and a future check render detail and hint; no JWT, code or proxy credentials in the output)

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<green gate output>
<CI run links>
<manual check: screenshot, copied report, proxy-credential check>

## Out of scope (left for later tickets)
- Settings and its link (DT-12), audit log (DT-13), file export, scheduled checks
```

Then **stop immediately**. Don't start DT-12, don't edit `docs/`, and don't merge.
