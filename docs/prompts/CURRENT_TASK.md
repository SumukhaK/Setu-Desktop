# Builder prompt · DT-06 · Session card and status strip

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-13). This ticket extends AD-11 (§3). The reviewer updates memory after merge.
2. `docs/TDD_TICKETS.md` §4 (stack) and §5 "DT-06".
3. `docs/JOURNEYS.md` rows P09 (the transport and path half) and P17 (the **Disconnect** part only).
4. `docs/SCREENS.md`: the layout block at the top (Listener │ Local ADB │ Transport) and row D04.
5. Setu-SDK v1.1.0 `API_SPEC.md` §1.5 (`listening`, `session_up`, `path_up`, `audit`), §2.1 (`session.stop`) and §3.1 (audit record `session_start`: `session` = tunnel id, `device`, `transport` ∈ `lan | relay-tcp | relay-ws | relay-wss`): https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
6. Existing code you'll use: `src-tauri/src/events/model.rs` (allowlist), `src-tauri/src/commands/session.rs`, `src/state/sessionStore.ts`, `src/features/adb/` (`attachmentOf`, `SessionAdbLine`, `useAdbStatus`), `src/App.tsx`.

**SDK facts this ticket relies on (verified against `core/` at v1.1.0):**
- The desktop daemon emits an audit record as an `event` notification with `type: "audit"`. The `session` field is empty, and `fields` is the record.
- A `session_start` record carries `role: "desktop"`, `device: <device_id>`, `session: <16-hex tunnel id>`, `transport`, and optionally `user` / `token_id`.
- Audit is off by default in Solo. So in Solo the transport is usually unknown until the first `path_up`, and **"Path unknown" is the correct, expected display**. Don't invent a transport.

## 1. Goal

Each live session gets a card: the device, then a three-fact status strip, then the loopback ADB row from DT-05, then **Disconnect**. The strip shows **Listener**, **Local ADB** and **Transport**, which are independent facts.

**Transport** comes from, in order:
1. The session's latest `path_up` transport.
2. Else an audit `session_start` transport for that session's device.
3. Else "Path unknown".

It never comes from `devices.presence`. **Disconnect** calls `session.stop {session_id}` in Rust. The card disappears when the session's `session_down` arrives through the store (P17). There's no rejoin timing or banners (DT-07), no nicknames (DT-08), no tray (DT-09), no styling beyond semantic markup, and no change to the prototype.

## 2. Files (create or change only these)

```
src-tauri/src/events/model.rs           + HubEvent::AuditSessionStart (§3); parse it before the empty-session check
src-tauri/src/commands/session.rs       + StopOutcome, stop_session()
src-tauri/tests/session_commands.rs     + stop tests
src-tauri/tests/event_hub.rs            + one test: an audit session_start crosses the bridge, an audit adb_op does not
src-tauri/src/app/mod.rs                inside `mod shell`: + #[tauri::command] session_stop
src/state/sessionStore.ts               + audit_session_start event type; LiveSession gains auditTransport
src/state/sessionStore.test.ts          + audit cases
src/features/session/transport.ts       transportOf(), transportLabel()
src/features/session/transport.test.ts
src/features/session/StatusStrip.tsx    three facts for one session
src/features/session/StatusStrip.test.tsx
src/features/session/SessionCard.tsx    device heading + StatusStrip + <SessionAdbLine> + Copy address + Disconnect
src/features/session/SessionCard.test.tsx
src/features/session/sessionPort.ts     SessionPort, StopOutcome mirror, stopMessage()
src/platform/tauri.ts                   + tauriSessionPort (still the only @tauri-apps/api import)
src/App.tsx, src/main.tsx, src/App.test.tsx   render <SessionCard> per live session instead of the bare <SessionAdbLine>
```

Don't change `src-tauri/src/rpc/`, `daemon/`, `adb/`, `events/gate.rs`, `events/hub.rs`, `src/features/adb/*` (reuse them as they are), `src/features/pair/*`, `src/daemon/*`, `docs/`, `README.md` or the prototype. Add no crate and no npm package.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**AD-11 extension (`model.rs`).** One audit shape is allowed across the bridge, and only these three fields:

```rust
AuditSessionStart { device_id: String, tunnel_id: String, transport: String },   // serde type "audit_session_start"
```

Parse it when **all** of the following hold:
- `type == "audit"`
- `fields.event == "session_start"`
- `fields.role == "desktop"`
- `fields.device` is a non-empty string
- `fields.session` is exactly 16 lowercase hex characters
- `fields.transport` is one of `lan`, `relay-tcp`, `relay-ws`, `relay-wss`

Handle this before the existing "empty `session` → Ignored" rule. Every other audit record (`adb_op`, `session_end`, `token_rotated`, …) and any `user` / `token_id` value stays `Ignored`, never forwarded. Add unit tests for each rejection, and assert the serialized JSON has exactly the keys `type`, `device_id`, `tunnel_id` and `transport`.

**Stop (`commands/session.rs`).**

```rust
#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum StopOutcome { Stopped, NoSession, NotReady, Invalid, Failed { code: Option<i64> } }

pub async fn stop_session(client: Option<RpcClient>, session_id: &str) -> StopOutcome;
```

`stop_session` works in this order:
1. `session_id` must match `^s[0-9]{1,9}$`, else return `Invalid` without calling the daemon.
2. No client → `NotReady`.
3. `call("session.stop", {"session_id": id})`, then map the result:
   - `Ok` → `Stopped`
   - `-32020` (`SetuError::NoSession`) → `NoSession`
   - else → `Failed{code}`

The shell command `session_stop(session_id: String) -> Result<StopOutcome, String>` takes the current `Ready` client the same way `session_connect_code` does, and always returns `Ok`.

**Store (`sessionStore.ts`).**
- `LiveSession` gains `auditTransport: string | null`. It starts as null for snapshots and `listening` / `session_up`, and the value is kept across upserts and snapshots, the same as `transport`.
- On `audit_session_start`:
  - Find the live sessions whose `deviceId === event.device_id`.
  - If there is **exactly one**, set its `auditTransport`. If there are zero or several, ignore the event; never guess.
  - The epoch and `synced` rules apply as for every event.
- `transport` (from `path_up`) is unchanged.

**Transport (`transport.ts`, pure).**

```ts
export type TransportSource = "path" | "audit" | "unknown";
export function transportOf(s: LiveSession): { transport: string | null; source: TransportSource };
export function transportLabel(t: string | null): string;
```

- `transportOf`:
  - `transport !== null` → `{transport, source: "path"}`
  - else `auditTransport !== null` → `{auditTransport, source: "audit"}`
  - else `{null, "unknown"}`
- `transportOf` takes **only** a `LiveSession`. There is no presence parameter, by design (P09).
- Labels:
  - `lan` → "LAN (direct)"
  - `relay-wss` → "Relay (WSS)"
  - `relay-ws` → "Relay (WS)"
  - `relay-tcp` → "Relay (TCP)"
  - null → "Path unknown"
  - any other string → that string unchanged

**StatusStrip (`features/session/StatusStrip.tsx`).** Props are `{ session: LiveSession; adb: AdbSnapshot | null }`. Render a `<ul aria-label="Session status">` with three `<li>`:
- `Listener: ready` (status `up`), `Listener: listening` (`listening`) or `Listener: reconnecting` (`retrying`).
- `Local ADB: <short>`, from `attachmentOf(session.adbAddr, adb)`:
  - attached → "attached"
  - unauthorized → "unauthorized"
  - offline → "offline"
  - absent → "not attached"
  - server_down → "server down"
  - unknown → "checking"
  - other → "connecting"
- `Transport: <transportLabel(...)>`. When the source is `audit`, append " (from audit log)".

Each fact is computed separately. A down ADB server or an unknown path never changes the Listener fact, and the other way round.

**SessionCard.** Props are `{ session, adb, adbPort, sessionPort, clipboard }`, where `clipboard: { writeText(s: string): Promise<void> }`. The card is an `<article>`:
- An `aria-labelledby` heading: `session.deviceId`.
- The `StatusStrip`.
- The DT-05 `<SessionAdbLine session adb port={adbPort}>`, unchanged.
- **Copy address**, shown only when `adbAddr !== null`. It calls `clipboard.writeText(adbAddr)` and shows "Copied" for that card.
- **Disconnect**: calls `sessionPort.stop(session.sessionId)` and is disabled while pending.
  - `stopped` and `no_session` show nothing extra. The card goes away when the store drops the session.
  - `stopMessage` text goes in `role="alert"`:
    - `not_ready`: "The Setu service isn't ready yet. Try again in a moment."
    - `invalid`: "This session can't be stopped from here."
    - `failed`: "Couldn't disconnect (error N). Try again." When `code` is null: "Couldn't disconnect. Try again."
- No confirmation dialog: Disconnect ends one session the user selected (P17). Quit's confirmation is DT-09.

**App.** Replace the per-session `<SessionAdbLine>` with `<SessionCard>`, keyed by `sessionId`. `main.tsx` passes `tauriSessionPort` and `navigator.clipboard`. Keep the session count line, the pair button and the daemon strip.

## 4. TDD: write these tests first, see them fail, then implement

- **Rust:**
  - `model.rs` audit cases: accepted, wrong role, `adb_op`, bad transport, a 15- or 17-character tunnel, uppercase hex, missing device, and an exact-keys JSON check that contains no `user` or `token_id`.
  - `session_commands.rs`:
    - `stop_session("s1")` sends exactly `{"session_id":"s1"}` and returns `Stopped`.
    - -32020 → `NoSession`.
    - -32603 → `Failed{Some(-32603)}`.
    - `"s"`, `"1"`, `"s1;rm"`, `"s1234567890"` and `""` → `Invalid`, with nothing sent.
    - No client → `NotReady`.
  - `event_hub.rs`: a live hub forwards an audit `session_start` as `Event{AuditSessionStart}` and drops an audit `adb_op`.
- **UI (Vitest):**
  - Store:
    - `audit_session_start` sets `auditTransport` only when exactly one live session has that device. Two sessions on the same device, or none, leave the state unchanged.
    - An old epoch is ignored.
    - `auditTransport` survives a snapshot that still lists the session.
  - `transportOf` / `transportLabel`:
    - path beats audit, audit beats unknown, unknown gives "Path unknown"
    - a `relay-wss` → `lan` path switch changes the label (P09 / DT-07 overlap)
    - every label
  - StatusStrip:
    - every Listener and ADB variant
    - " (from audit log)" appears only for the audit source
    - ADB `down` with Listener `up` still reads "Listener: ready" (independence)
  - SessionCard, with fake ports and a fake clipboard:
    - **P17:** Disconnect calls `stop("s1")` once, is disabled while pending, and each non-silent outcome shows its exact copy.
    - Copy address writes the exact `adbAddr`.
    - Copy address is hidden when the address is null.
  - App:
    - A snapshot with one session renders one card.
    - After the fake hub pushes `session_down` for it, the card is gone.

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

Also run `npm run tauri dev` once with a real `setu-daemon` v1.1.0. If you can pair a phone:
- Confirm the card shows `Listener: ready`, the ADB fact and `Transport: Path unknown`. In Solo with audit off, "Path unknown" is expected.
- Confirm Disconnect removes the card.

If you can't pair a phone, say so. Name the OS.

Use no `#[allow(...)]`, no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no `unwrap()` or `expect()` outside tests, and no clippy or lint downgrades. If a gate fails for a reason you can't fix in code, stop and report the exact error.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** Rust validates the session id and owns `session.stop`. The bridge gains exactly one audit shape with three fields. React decides only how to display facts it was given.
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. If the daemon's audit `session_start` differs from the shape in §0 when you run it, follow the daemon, add a test for it and record it.
2. **Simplicity first.** No routing, no card list virtualisation, no clipboard library, no confirmation modal, no CSS. Keep files under ~250–300 lines.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-06-session-card`. Make atomic conventional commits:
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first, then the implementation. Paste the red excerpt and the full green output of every gate in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-06 session card and status strip`, with this body:

```
Ticket: DT-06 (docs/TDD_TICKETS.md §5) · Acceptance: P09 (transport source order, independent facts), P17 (Disconnect)

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<full green output of every gate>
<tauri dev manual check: card facts, Disconnect, or "no phone available">

## Out of scope (left for later tickets)
- rejoin timing and banners (DT-07), nicknames and device list (DT-08), tray and quit (DT-09), corporate presence (DT-15)
```

Then **stop immediately**. Don't start DT-07, don't edit `docs/`, and don't merge.
