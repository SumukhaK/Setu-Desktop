# Builder prompt · DT-10 · Android 11+ debugger pairing

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-14).
2. `docs/TDD_TICKETS.md` §5 "DT-10", §3 rows P05 and P20, and §7 (the device-lab gate).
3. `docs/JOURNEYS.md`: the `session.pair_adb` paragraph, the version-skew rule (`-32024`), and rows P05 and P20.
4. Setu-SDK v1.1.0 `API_SPEC.md`: `PairADB` (§1.1), the `adb_pair` event (§1.5), `session.pair_adb` and `session.cancel` (§2), and the error table (§2.3): https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
5. Existing code you'll use or mirror:
   - `src-tauri/src/commands/session.rs` (`PairingCode`, `PendingConnect`, `claim_slot`, `SlotGuard`, `connect_with_code`, `cancel_pending`)
   - `src-tauri/src/commands/devices.rs` (`valid_device_id`)
   - `src-tauri/src/rpc/errors.rs` (`SetuError::AdbPairFailed` = -32023, `Unsupported` = -32024, `NotPaired` = -32012, `Unavailable` = -32011, `Cancelled` = -32022)
   - `src-tauri/src/app/mod.rs` (command registration), `src-tauri/tests/session_commands.rs` (FakeDaemon patterns)
   - `src/features/pair/` (`PairDialog`, `pairPort.ts`), `src/features/adb/SessionAdbLine.tsx`, `src/features/session/SessionCard.tsx`, `src/app/WorkspacePage.tsx`, `src/App.tsx`, `src/platform/tauri.ts`, `src/main.tsx`

**Facts this ticket relies on (read by the reviewer in the v1.1.0 daemon source, `core/internal/daemon/daemon.go`):**
- `session.pair_adb` params are `{device_id, pairing_code, pairing_port?, adb_path?, timeout_ms?}`. The daemon decodes them **strictly**, so an unknown key returns `-32602`.
  - `device_id` and `pairing_code` are required.
  - `timeout_ms` ≤ 0 becomes 60000.
  - `pairing_port` 0 or absent makes the phone discover `_adb-tls-pairing._tcp` itself.
- The result is `{device_id, paired, transport, output?}`. `output` is raw `adb pair` text, so the desktop drops it.
- Errors:
  - a code that isn't 6 digits → `bad_code`
  - an unknown device → `-32012`
  - adb rejected the code, or nothing answered on the port → `-32023`
  - the phone runs a 1.0 agent → `-32024`
  - cancelled → `-32022`
- `session.cancel {request_id}` cancels the in-flight request on that connection. `call_cancellable` already does this (AD-12).
- The daemon picks adb from its own `--adb` flag (`DaemonConfig.adb_path`). The desktop never sends `adb_path`.
- The `adb_pair` event reports the same outcome. The requesting client already has the result, so the hub allowlist stays as it is (AD-11). Don't forward it.
- There is no logging crate. The only native text sink today is `eprintln!` in `app::run`.

## 1. Goal

On a live session's card, **Pair debugger** opens a dialog. The user enters the six-digit code from the phone's *Wireless debugging → Pair device with pairing code* screen, plus an optional port. The desktop calls `session.pair_adb` once with exactly those values (P05).
- **Success:** the dialog closes, and the card says the debugger is paired and to use **Connect ADB**.
- **`-32023`:** the form stays open with the code cleared and asks for a fresh code.
- **`-32024`:** shows "Update Setu on the phone to use this." (P20).

The code is never logged, persisted, put in a crash report or held in App state. The feature stays **behind a build flag** until the §7 device-lab gate passes.

Out of scope:
- Forwarding the `adb_pair` event.
- mDNS discovery on the desktop.
- Showing `output`.
- Diagnostics export (DT-11).
- Enabling the flag by default.

## 2. Files (create or change only these)

```
src-tauri/src/log/mod.rs, src-tauri/src/log/redact.rs   pure redact(); unit tests in redact.rs
src-tauri/src/lib.rs                                    pub mod log;
src-tauri/src/commands/pair_adb.rs                      AdbPairCode, PairAdbOutcome, pair_adb()
src-tauri/src/commands/mod.rs                           pub mod pair_adb; re-exports
src-tauri/src/commands/session.rs                       visibility only: claim_slot / SlotGuard → pub(crate)
src-tauri/tests/pair_adb_commands.rs                    FakeDaemon tests (§4)
src-tauri/src/app/mod.rs                                + command session_pair_adb; eprintln goes through redact()
src/features/pair-adb/pairAdbPort.ts                    outcome mirror, PairAdbPort, pairAdbMessage(), parseAdbPairInput()
src/features/pair-adb/PairAdbDialog.tsx (+ .test.tsx)
src/features/adb/SessionAdbLine.tsx (+ test)            optional onPairDebugger → "Pair debugger" button
src/features/session/SessionCard.tsx (+ test)           optional pairAdbPort; owns dialog open + paired notice
src/app/WorkspacePage.tsx, src/App.tsx, src/App.test.tsx   thread optional pairAdbPort through
src/platform/tauri.ts                                   + tauriPairAdbPort
src/vite-env.d.ts                                       ImportMetaEnv { readonly VITE_SETU_ADB_PAIR?: string }
src/main.tsx                                            pass pairAdbPort only when VITE_SETU_ADB_PAIR === "1"
README.md                                               one line: how to build with the flag on
```

Don't touch `daemon/`, `rpc/`, `events/`, `adb/`, `store/`, `capabilities/`, `tauri.conf.json`, `src/state/`, `src/styles/`, `docs/`, the prototype or CI. Add no crate (no `regex`, no `log`/`tracing`) and no npm package.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Redaction (`log/redact.rs`, pure, no Tauri).** `pub fn redact(input: &str) -> String` masks, in this order:
1. every `NNNN-NNNNNN` code (4 digits, `-`, 6 digits, not touching other digits) → `****-******`
2. every run of **exactly 6** ASCII digits not touching other digits → `******`. It is deliberately broad: a 6-digit pid also gets masked, and that's acceptable.
3. the string value of the JSON keys `"pairing_code"`, `"token"` and `"auth_token"` → `"[redacted]"`, whatever its length

Hand-write the scanning (no regex crate). Everything else passes through byte-for-byte.

**Native command (`commands/pair_adb.rs`, no Tauri).**

```rust
pub struct AdbPairCode(String);          // exactly 6 ASCII digits; no Debug, Clone, Serialize
impl AdbPairCode { pub fn parse(raw: &str) -> Option<Self>; }

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum PairAdbOutcome {
    Paired { transport: String },
    Malformed,          // bad code, or a port of 0 (the UI sends None for "discover")
    InvalidDevice,      // fails valid_device_id
    NotReady,
    AlreadyPending,     // the shared PendingConnect slot is taken
    PairFailed,         // -32023, or a result with paired: false
    Unsupported,        // -32024
    NotPaired,          // -32012
    Unavailable,        // -32011
    Cancelled,          // -32022
    Failed { code: Option<i64> },
}

pub async fn pair_adb(
    client: Option<RpcClient>,
    device_id: &str,
    raw_code: &str,
    pairing_port: Option<u16>,
    pending: &PendingConnect,
) -> PairAdbOutcome;
```

- Validate in this order: code, then port, then device id, then client, then slot. A malformed input never reaches the daemon.
- Share `PendingConnect` with the two connect flows, so only one of the three runs at a time. Cancel goes through the existing `session_cancel_connect` command.
- Params are exactly `{"device_id", "pairing_code", "timeout_ms": 60000}`, plus `"pairing_port"` only when it's `Some`. Never send `adb_path`.
- Parse the result as `{paired: bool, transport: String}`. Ignore `output` and never keep it. A missing field gives `Failed { code: None }`.
- Shell: `#[tauri::command] async fn session_pair_adb(device_id: String, pairing_code: String, pairing_port: Option<u16>, ..) -> Result<PairAdbOutcome, String>`. Pass the existing `eprintln!` in `run()` through `redact()`.

**UI.**
- `pairAdbPort.ts`:
  - the `PairAdbOutcome` mirror
  - `PairAdbPort { pair(deviceId, code, port: number | null): Promise<PairAdbOutcome>; cancel(): Promise<boolean> }`
  - `parseAdbPairInput(code, port)`: strips spaces from the code and requires 6 digits; port is empty → `null`, otherwise an integer 1–65535
  - `pairAdbMessage(outcome)`:
    - `paired`, `cancelled` → `null`
    - `malformed` → "Enter the 6-digit code and, if one is shown, a port from 1 to 65535."
    - `pair_failed` → "Pairing didn't work. Get a new code on the phone and try again."
    - `unsupported` → "Update Setu on the phone to use this."
    - `not_paired` → "This device isn't paired any more. Pair it again with a new code."
    - `unavailable` → "The phone is offline or can't be reached. Check that Setu is hosting on it."
    - `already_pending` → "Another connection is already in progress."
    - `not_ready` → "The Setu service isn't ready yet. Try again in a moment."
    - `invalid_device` and `failed{code}` → "Couldn't pair (error N). Try again.", or "Couldn't pair. Try again." when there's no code
- `PairAdbDialog` (`role="dialog"`, `aria-labelledby`, the `dialog*` classes like `PairDialog`):
  - Title: "Pair debugger (Android 11+)".
  - Hint: "On the phone, open Settings › Developer options › Wireless debugging › Pair device with pairing code."
  - Fields: "Pairing code" (`inputMode="numeric"`, `autoComplete="off"`) and "Port (optional)". Their state is **local to the dialog**, never lifted.
  - Buttons: **Pair** (`button primary`) and **Cancel** (`button quiet`).
  - Submit validates with `parseAdbPairInput` first. Then it calls `pair()` once, shows "Pairing…" and disables **Pair**.
  - `paired` calls `onPaired()`. `cancelled` calls `onClose()`.
  - `pair_failed` keeps the dialog open, clears the code and keeps the port. Every other outcome shows its message in `<p role="alert" className="notice">`.
  - A rejected promise shows "Couldn't reach the Setu service. Try again." In every case, clear the pending state in `finally`.
  - **Cancel** while pending calls `port.cancel()`. Unmount while pending also calls `port.cancel()`, the same way `PairDialog` does after UK-04.
- `SessionAdbLine`: new optional `onPairDebugger`. When it's given and the attachment isn't `"attached"`, render **Pair debugger** (`button secondary`) next to **Connect ADB**.
- `SessionCard`: new optional `pairAdbPort`.
  - It holds `pairingDebugger: boolean` and `debuggerPaired: boolean`, passes `onPairDebugger` only when the port exists, and renders the dialog.
  - On `onPaired`, close the dialog and show `<p role="status">Debugger paired. Use Connect ADB to attach.</p>`. Hide that line once the attachment becomes `"attached"`.
- `WorkspacePage` and `App` only pass the optional port through.
- `main.tsx` passes `pairAdbPort={tauriPairAdbPort}` only when `import.meta.env.VITE_SETU_ADB_PAIR === "1"`.
- No inline styles and no new CSS.

## 4. TDD: write these tests first, see them fail, then implement

- **`redact.rs` unit tests:**
  - `1234-567890` and `482913` are masked
  - `12345`, `1234567` and a port `:37099` are untouched
  - `{"pairing_code":"482913","x":1}` becomes `{"pairing_code":"[redacted]","x":1}`
  - `"token":"eyJ…"` is redacted
  - non-ASCII text passes through unchanged
- **`tests/pair_adb_commands.rs`** (FakeDaemon, every wait under `timeout`):
  - **Exact params:** port 37099 → exactly `{"device_id":"pixel-7","pairing_code":"482913","pairing_port":37099,"timeout_ms":60000}`. Port `None` → no `pairing_port` key. `adb_path` is never sent.
  - **Malformed input, no request sent:** `"48291"`, `"4829135"`, `"48a913"`, port `Some(0)` and an invalid device id each return `Malformed` or `InvalidDevice`.
  - **Result mapping:**
    - `{paired:true, transport:"lan", output:"Successfully paired…"}` → `Paired{transport:"lan"}`
    - `{paired:false, transport:"lan"}` → `PairFailed`
    - errors `-32023`, `-32024`, `-32012`, `-32011` → their variants
    - `-32603` → `Failed{Some(-32603)}`
  - **Slot:** a connect holding the slot → `AlreadyPending`. Cancel during an in-flight pair sends `session.cancel {request_id}` and returns `Cancelled`. The slot is free afterwards.
  - **Never stored:** after a pair call with `482913`, no file under the test's state tempdir contains `482913`. The `PairAdbOutcome` `Debug` text never contains it either.
- **`PairAdbDialog.test.tsx`:**
  - Submitting with an invalid code or port 70000 shows the malformed message and doesn't call `pair`.
  - A valid submit calls `pair("pixel-7", "482913", 37099)` once; an empty port calls it with `null`.
  - A double click calls `pair` only once.
  - `pair_failed` clears the code, keeps the port and shows the message.
  - `unsupported` shows "Update Setu on the phone to use this."
  - Cancel while pending calls `cancel`, and so does unmount while pending.
  - A rejected promise shows the service message.
- **`SessionCard` / `SessionAdbLine` tests:**
  - No **Pair debugger** without a port, or when attached.
  - `paired` closes the dialog and shows the status line, which hides once the ADB snapshot shows `attached`.
  - Reopening the dialog shows an empty code field.
- **`App.test.tsx`:** without `pairAdbPort` there's no **Pair debugger** anywhere, which is the flag-off default.

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

**Manual check** (name the OS): run `VITE_SETU_ADB_PAIR=1 npm run tauri dev` with a real daemon. If you have an Android 11+ phone, pair the debugger through a live session, then **Connect ADB**. Otherwise, show the `-32012` path against a forgotten device id and say "no Android 11+ phone available".

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.**
  - Rust re-validates the code and port and owns the request and its cancellation (AD-12).
  - The code never crosses back to the UI, and it isn't in any `Debug` output (AD-5).
  - `redact()` is the one choke point for native text from now on; DT-11 builds on it.
  - The UI keeps the code only in the open dialog's local state.
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. If the real daemon differs from §0, follow the daemon, test it and record it.
2. **Simplicity first.** One pure redaction module, one command, one dialog, one port. No logging framework, no settings UI for the flag.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-10-pair-adb`, with atomic commits:
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first. Paste the red excerpt, the green gate output, the CI links and the manual check in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-10 Android 11+ debugger pairing`, with this body:

```
Ticket: DT-10 (docs/TDD_TICKETS.md §5) · Acceptance: P05 (rewritten: exact params once, paired → Connect ADB, -32023 keeps the form, -32024 update copy, code never logged or stored), P20 (-32024 copy), redaction

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<green gate output>
<CI run links>
<manual check, or "no Android 11+ phone available" plus the -32012 path>

## Out of scope (left for later tickets)
- adb_pair event forwarding, desktop mDNS, diagnostics export (DT-11), enabling the flag by default (after the §7 device-lab gate)
```

Then **stop immediately**. Don't start DT-11, don't edit `docs/`, and don't merge.
