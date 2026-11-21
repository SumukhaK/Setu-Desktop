# Builder prompt · DT-04 · Solo pairing form with cancel

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-11). This ticket adds AD-12 (§3). The reviewer writes it into memory after merge.
2. `docs/TDD_TICKETS.md` §4 (stack) and §5 "DT-04".
3. `docs/JOURNEYS.md` rows P02, P03 and P19.
4. `docs/SCREENS.md` row D02 (Pair new device sheet).
5. Setu-SDK v1.1.0 `API_SPEC.md` §2.1 (`session.connect`, `session.cancel`), §2.3 (errors) and §2.4 (the cancel example): https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
6. Existing code you'll use: `src-tauri/src/rpc/client.rs` (`RpcClient`), `src-tauri/src/events/model.rs` (`SessionInfo`), `src-tauri/src/app/mod.rs` (the `shell` module), `src/state/useSessions.ts`, `src/platform/tauri.ts`.

## 1. Goal

From the main window, the user opens **Pair new device** and types or pastes the ten-digit code shown on the phone. The code is shown as `NNNN-NNNNNN`, leading zeroes kept. They submit it, and Rust calls `session.connect {pairing_code, timeout_ms: 60000}` on the supervisor's connection.
- **Success:** the dialog closes. The live session then appears through the DT-03b store ("1 live session").
- **Wrong code (`-32013`):** one combined message.
- **Unreachable (`-32011`):** an unavailable message.
- **Cancel while pending:** sends `session.cancel {request_id}` for that exact JSON-RPC request. The connect resolves with `-32022`, and the dialog closes with no error (P19).

The code is never logged, persisted or put in a type that derives `Debug`. There's no device list (DT-08), no `device_id` reconnect UI, no `pair_adb` (DT-10), no styling, and no change to the prototype.

## 2. Files (create or change only these)

```
src-tauri/src/rpc/client.rs              + call_cancellable (§3); split request_once into send + await, no behaviour change for call()
src-tauri/tests/rpc_client.rs            + cancellable-call tests
src-tauri/tests/support/fake_daemon.rs   + reply_error_delayed(method, error, delay)
src-tauri/src/lib.rs                     + pub mod commands;
src-tauri/src/commands/mod.rs            re-exports
src-tauri/src/commands/session.rs        PairingCode, ConnectOutcome, PendingConnect, connect_with_code, cancel_pending (no tauri import)
src-tauri/tests/session_commands.rs      integration tests with FakeDaemon
src-tauri/src/app/mod.rs                 inside `mod shell`: keep the Supervisor handle usable, two tauri commands (§3)
src/features/pair/codeFormat.ts          parseCodeInput()
src/features/pair/codeFormat.test.ts
src/features/pair/pairPort.ts            PairPort, ConnectOutcome (mirrors Rust), outcomeMessage()
src/features/pair/PairDialog.tsx
src/features/pair/PairDialog.test.tsx
src/platform/tauri.ts                    + tauriPairPort (still the only @tauri-apps/api import)
src/App.tsx, src/main.tsx                "Pair new device" button toggles <PairDialog />; pass pairPort
src/App.test.tsx                         App opens and closes the dialog
```

Don't change `src-tauri/src/daemon/`, `src-tauri/src/events/`, `docs/`, `README.md` or the prototype (`index.html`, `prototype.js`, `styles.css`). Add no crate and no npm package.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**AD-12: cancel by request id inside the client.** The JSON-RPC id stays private to `RpcClient`. Callers get cancellation as a signal, not an id.

```rust
/// Like `call`, including the one `-32027` retry. If `cancel` fires while a
/// request is in flight, sends `session.cancel {"request_id": <that id>}` on this
/// same connection (ignore its result), then keeps awaiting the original reply,
/// which the daemon answers with -32022 → Err(SetuError::Cancelled).
/// If `cancel` fires during the busy back-off, return Err(Cancelled) without
/// sending the retry. A dropped sender (RecvError) means "never cancel".
/// Cancel acts at most once.
pub async fn call_cancellable(&self, method: &str, params: Option<Value>,
    cancel: oneshot::Receiver<()>) -> Result<Value, SetuError>;
```

Use the numeric id (`"request_id": 7`). The daemon compacts the raw JSON id, so a number matches. Wait on the reply and the cancel signal with `tokio::select!`. Never drop the pending reply before it resolves.

**`commands/session.rs` (pure Rust, unit- and integration-testable without Tauri).**

```rust
/// Exactly ^[0-9]{4}-[0-9]{6}$. No Debug, Display, Serialize or Clone. Dropped after the call.
pub struct PairingCode(String);
impl PairingCode { pub fn parse(raw: &str) -> Option<PairingCode>; }

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ConnectOutcome {
    Connected { session_id: String, device_id: String, adb_addr: String },
    Malformed,          // PairingCode::parse failed; the daemon is never called
    NotReady,           // no Ready client
    AlreadyPending,     // a connect is already in flight
    BadCode,            // -32013
    Unavailable,        // -32011
    Cancelled,          // -32022
    Failed { code: Option<i64> },   // anything else, incl. UnexpectedResult / Disconnected (code None)
}

#[derive(Default)]
pub struct PendingConnect(std::sync::Mutex<Option<oneshot::Sender<()>>>);

pub async fn connect_with_code(client: Option<RpcClient>, raw: &str, pending: &PendingConnect) -> ConnectOutcome;
pub fn cancel_pending(pending: &PendingConnect) -> bool;   // true if a pending connect was signalled
```

`connect_with_code` works in this order:
1. Parse the code, else return `Malformed`.
2. Take the client, else return `NotReady`.
3. Store a cancel sender in the slot. If the slot is occupied, return `AlreadyPending`.
4. Call `call_cancellable("session.connect", {"pairing_code": <code>, "timeout_ms": 60000}, rx)`.
5. **Always** clear the slot, on every path (use a small guard).
6. Map the result:
   - `Ok`: deserialize `events::SessionInfo` into `Connected`. A bad shape is `Failed{code: None}`.
   - `BadCode`, `Unavailable` and `Cancelled` map one to one.
   - Anything else maps to `Failed{code: e.code()}`.

`cancel_pending` takes the sender and sends `()`. It is a no-op returning `false` when nothing is pending. The code and the slot never appear in an error, a log or `ConnectOutcome`.

**`app/mod.rs` (shell).**
- Keep the `Supervisor` in `AppState` as a usable field, not `_supervisor`. Add `pending: PendingConnect`.
- `#[tauri::command] async fn session_connect_code(code: String, state) -> ConnectOutcome`. It takes the current client from `supervisor.subscribe().borrow()` when that state is `Ready`, otherwise `None`, then calls `connect_with_code`.
- `#[tauri::command] fn session_cancel_connect(state) -> bool` calls `cancel_pending`.
- With no supervisor (NotConfigured), connect returns `NotReady` and cancel returns `false`.
- Register both commands next to `daemon_status` and `session_resync`. Don't clone the `String` code anywhere else.

**UI (AD-9: features take ports; only `src/platform/tauri.ts` imports Tauri).**

```ts
// codeFormat.ts
export interface CodeInput { display: string; code: string | null; problem: "characters" | "length" | null }
export function parseCodeInput(raw: string): CodeInput;
```

`parseCodeInput` rules:
- Trim the input.
- If it contains anything other than digits, `-` or spaces, return `{display: raw, code: null, problem: "characters"}`.
- Otherwise strip the separators to get the digits.
  - More than 10 digits: `problem: "length"`, with `display` = the first 10 digits formatted.
  - Otherwise `display` = the first 4 digits, then `-` and the rest once there are more than 4.
- `code` is set (`"NNNN-NNNNNN"`) only when the trimmed input matches `^\d{10}$` or `^\d{4}[- ]\d{6}$`. So `"0012-345678"`, `"0012345678"` and `"0012 345678"` are valid, and `"00-12345678"`, `"0012--345678"`, `"0012-3456"` and `"0012-34567a"` aren't.
- Leading zeroes are always kept, because codes are strings and never numbers.

```ts
// pairPort.ts
export type ConnectOutcome =
  | { outcome: "connected"; session_id: string; device_id: string; adb_addr: string }
  | { outcome: "malformed" } | { outcome: "not_ready" } | { outcome: "already_pending" }
  | { outcome: "bad_code" } | { outcome: "unavailable" } | { outcome: "cancelled" }
  | { outcome: "failed"; code: number | null };
export interface PairPort { connect(code: string): Promise<ConnectOutcome>; cancel(): Promise<boolean> }
export function outcomeMessage(o: ConnectOutcome): string | null;   // null for connected and cancelled
```

Copy is exact:
- `bad_code`: "That code didn't work. Check the 10 digits and that the phone is still hosting. After 3 wrong tries the phone shows a new code."
- `unavailable`: "The phone can't be reached right now. Make sure Setu is hosting on the phone, then try again."
- `not_ready`: "The Setu service isn't ready yet. Try again in a moment."
- `already_pending`: "A connection is already in progress."
- `malformed`: "Enter the 10 digits shown on the phone."
- `failed`: "Couldn't connect (error N). Try again." When `code` is null: "Couldn't connect. Try again."

`PairDialog({ port, onClose })`:
- A `role="dialog"` with `aria-labelledby` on the heading "Pair new device".
- One `<input>` labelled "Pairing code", with `inputMode="numeric"`, `autoComplete="off"` and `spellCheck={false}`. Its value is `parseCodeInput(raw).display`.
- While `problem` is set, show the inline hint "Use only the 10 digits shown on the phone." and set `aria-invalid`.
- **Connect** is enabled only when `code !== null` and nothing is pending.
- While pending:
  - Show "Connecting…".
  - Disable the input and Connect.
  - **Cancel** calls `port.cancel()`.
- Closing:
  - With no connect pending, Cancel just calls `onClose()`.
  - `connected` or `cancelled` calls `onClose()`.
  - Any other outcome shows `outcomeMessage` in `role="alert"`, keeps the typed code so the user can fix it, and re-enables the form.
- No timer, countdown or code-expiry text, ever (P03: only the phone's SDK event changes the code).
- The code lives only in component state: no storage, no URL, no `console`.

`App`: a "Pair new device" button renders `<PairDialog port={pairPort} onClose={…} />`. Keep the DT-03b session line.

## 4. TDD: write these tests first, see them fail, then implement

- **`tests/rpc_client.rs` (FakeDaemon):**
  - **Cancel mid-call:**
    1. Script the `session.connect` reply with `reply_error_delayed` (-32022, kind `cancelled`, 300 ms) and `session.cancel` with `{cancelled:1}`.
    2. Fire `cancel` after the connect is received.
    3. The result is `Err(Cancelled)`.
    4. `received()` shows the `session.cancel` params `{"request_id": <connect's id>}`.
  - A dropped cancel sender behaves exactly like `call`: the result comes through and no `session.cancel` is sent.
  - Cancel during the busy back-off: first reply -32027, then fire `cancel`. The result is `Err(Cancelled)`, with exactly one `session.connect` and no `session.cancel` received.
  - Cancel after the reply has arrived does nothing.
- **`commands/session.rs` unit tests:**
  - `PairingCode::parse` accepts `0012-345678` and rejects `0012345678`, `00123-45678`, letters, `""` and 11 digits.
  - The `ConnectOutcome` serde tags and field names.
  - `cancel_pending` on an empty slot returns `false`.
- **`tests/session_commands.rs` (FakeDaemon):**
  - **P02:** `"0012-345678"` sends exactly `{"pairing_code":"0012-345678","timeout_ms":60000}`, and a scripted `SessionInfo` gives `Connected`.
  - `Malformed` and `NotReady` send nothing to the daemon.
  - -32013 → `BadCode` and -32011 → `Unavailable`. -32020 → `Failed{code: Some(-32020)}`.
  - **P19:** start a connect, then `cancel_pending` returns `true`. The outcome is `Cancelled`, and the `session.cancel` request id equals the connect's id.
  - A second concurrent connect → `AlreadyPending`, and a connect after the first one finishes is accepted, so the slot was cleared.
  - Neither the code string nor any `ConnectOutcome` JSON contains the code, except the request params sent to the daemon.
- **UI (Vitest + Testing Library, with a fake `PairPort`):**
  - `parseCodeInput` table, covering every example in §3, including leading zeroes and paste of `"0012345678"` → `"0012-345678"`.
  - **P02:** typing `0012345678` shows `0012-345678`, and Connect calls `port.connect("0012-345678")` once. Letters or a partial code keep Connect disabled and show the hint.
  - **P19:** with a pending connect that resolves only after `cancel()`, Cancel calls `port.cancel()`, then `cancelled` closes the dialog without an alert.
  - Each error outcome shows its exact copy in `role="alert"` and keeps the input value.
  - No element's text matches `/\d+\s*(s|sec|min)|expire/i` (no timer, P03).
  - `localStorage` and `sessionStorage` are empty after a submit.
  - **App:** the button opens the dialog and `onClose` hides it.

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

Also run `npm run tauri dev` once with a real `setu-daemon` v1.1.0 (`SETU_RELAY_URL`, `SETU_DAEMON_PATH`).
- Confirm that a malformed code can't be submitted.
- Confirm that submitting a well-formed code with no phone hosting ends in an error message or a pending state, and that Cancel then closes the dialog cleanly.
- If you can pair a real phone, confirm that "1 live session" appears. Otherwise say so; it isn't required.
- Name the OS.

Use no `#[allow(...)]`, no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no `unwrap()` or `expect()` outside tests (the existing `expect("pending calls")` lock calls in `client.rs` may stay), and no clippy or lint downgrades. If a gate fails for a reason you can't fix in code, stop and report the exact error.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** The JSON-RPC id, the connection and the error objects stay in Rust. React sends the formatted code once and gets back only a `ConnectOutcome`. Rust re-validates the code and never trusts the UI's formatting.
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. If the daemon behaves differently from §2.4 (for example, the cancel answers `{cancelled:0}` because the connect already finished), handle it the way §3 describes and record it there.
2. **Simplicity first.** One slot, one dialog, no router, no form library, no state library, no styling. Keep files under ~250–300 lines.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-04-pair-dialog`. Make atomic conventional commits:
   - `refactor(desktop): …` for the `request_once` split, with existing tests green
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first, then the implementation. Paste the red excerpt and the full green output of every gate in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-04 solo pairing form with cancel`, with this body:

```
Ticket: DT-04 (docs/TDD_TICKETS.md §5) · Acceptance: P02, P03, P19

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<full green output of every gate>
<tauri dev manual check: malformed blocked, pending + Cancel, (1 live session if a phone was paired)>

## Out of scope (left for later tickets)
- local ADB attach (DT-05), session card (DT-06), device list and device_id reconnect (DT-08), Android debugger pairing (DT-10)
```

Then **stop immediately**. Don't start DT-05, don't edit `docs/`, and don't merge.
