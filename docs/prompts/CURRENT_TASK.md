# Builder prompt · DT-03b · Event hub and session store

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-9; AD-1 was updated for the DT-03a shell). This ticket adds AD-10 and AD-11 (§3); the reviewer writes them into memory after merge.
2. `docs/TDD_TICKETS.md` §4 (stack) and §5 "DT-03b".
3. `docs/JOURNEYS.md` rows P14 (the "events keyed by tunnel id; stale tunnel or stopped session can't overwrite" part only), P17 (restore), P18 ("re-lists sessions") and P21.
4. Setu-SDK v1.1.0 `API_SPEC.md` §1.5 (event types, path events), §2.1 (`events.subscribe`, `session.list`, `SessionInfo`) and §2.2 (`event`, `events.dropped`): https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
5. Existing code you'll use: `src-tauri/src/rpc/` (`RpcClient`, `Notification`, `SetuError`), `src-tauri/src/daemon/` (`Supervisor`, `DaemonState`, `Workspace`), `src-tauri/src/app/`, `src/daemon/`, `src/platform/tauri.ts`, `tests/support/fake_daemon.rs`.

## 1. Goal

A Rust event hub opens its own authenticated connection to the workspace daemon, calls `events.subscribe`, takes a `session.list` snapshot and pushes one ordered stream of typed, secret-free messages to the UI. A TypeScript reducer turns that stream into the session store that DT-04 to DT-07 render. On `events.dropped`, a daemon restart (new generation) or a UI request, the hub resyncs: events that arrive while `session.list` is in flight are held and released only after the snapshot (P21). Events for a session that has ended, or for a tunnel that is already lost, never change state (P14 part). There's no session card, no rejoin banner (DT-07), no pairing (DT-04), no corporate presence (DT-15), and no change to the prototype.

## 2. Files (create or change only these)

```
src-tauri/src/lib.rs                    + pub mod events;
src-tauri/src/daemon/supervisor.rs      DaemonState::Ready gains `listen: SocketAddr`; + pub async fn connect_authenticated (§3)
src-tauri/src/daemon/mod.rs             re-export connect_authenticated
src-tauri/tests/daemon_supervisor.rs    only: add `..` / `listen` to the Ready patterns so it compiles; assert Ready.listen == record listen in the existing spawn test
src-tauri/src/events/mod.rs             re-exports
src-tauri/src/events/model.rs           SessionInfo, HubEvent, HubMessage, parse_notification() (pure)
src-tauri/src/events/gate.rs            ResyncGate state machine (pure, no IO)
src-tauri/src/events/hub.rs             EventHub: watch supervisor state, connect, subscribe, list, forward
src-tauri/src/app/mod.rs                inside the existing #[cfg(not(test))] mod shell: start the hub, emit "session-hub", command session_resync
src-tauri/tests/event_hub.rs            integration tests with FakeDaemon
src/state/clock.ts                      Clock interface + systemClock (performance.now)
src/state/sessionStore.ts               types, initialState, reduce(state, msg, now)
src/state/useSessions.ts                SessionHubPort, useSessions(port, clock)
src/state/clock.test.ts
src/state/sessionStore.test.ts
src/state/useSessions.test.tsx
src/platform/tauri.ts                   + tauriSessionHubPort (invoke "session_resync", listen "session-hub")
src/App.tsx, src/main.tsx               pass the port; one plain line "No live sessions" / "N live session(s)" under the strip
```

Don't change `src-tauri/src/rpc/`, `tests/support/*`, `docs/`, `README.md` or the prototype (`index.html`, `prototype.js`, `styles.css`). Add no crate and no npm package.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**AD-10: dedicated events connection.** The supervisor's own connection stays the liveness probe and never subscribes. The hub opens a second connection to `Ready.listen` with:

```rust
/// Connects to a loopback daemon and authenticates with <state_dir>/daemon.token.
/// Non-loopback addr → Err(SetuError::Unauthorized) without connecting. Missing/empty token → Err(Unauthorized).
pub async fn connect_authenticated(listen: SocketAddr, state_dir: &Path)
    -> Result<(RpcClient, mpsc::UnboundedReceiver<Notification>), SetuError>;
```

Reuse the existing `read_token`; the token never leaves `daemon/`.

**AD-11: typed allowlist across the bridge.** Raw daemon events never reach the UI. `parse_notification(&Notification) -> Parsed` with `enum Parsed { Event(HubEvent), Dropped { count: u64 }, Ignored }`. Only these event types are forwarded. Everything else (`audit`, `token_updated`, `adb_pair`, `paired`, `pairing_code`, device-side types, unknown future types) is `Ignored`, as is any allowlisted event with a missing or wrongly typed required field. Error strings are never forwarded.

```rust
#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HubEvent {
    Listening   { session: String, addr: String, device_id: String },
    SessionUp   { session: String, addr: String, device_id: String },
    Retrying    { session: String, attempt: u32, delay_ms: u64 },
    SessionDown { session: String, abnormal: bool },              // abnormal = fields.error present
    PathDown    { session: String, tunnel_id: String, reason: String, transport: String },
    PathUp      { session: String, tunnel_id: String, transport: String, outage_ms: u64 },
    PathLost    { session: String, tunnel_id: String, reason: String, outage_ms: u64 },
    SessionExpired { session: String, device_id: String, reason: String },
    PeerClosed  { session: String, device_id: String, peer_reason: String },
}
// `session` = Event.session ("s1"…); `tunnel_id` = fields.session_id (16 hex). An event with an empty `session` is Ignored.

#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct SessionInfo { pub session_id: String, pub adb_addr: String, pub device_id: String, pub started: String }

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HubMessage {
    Snapshot    { epoch: u64, generation: u64, sessions: Vec<SessionInfo> },
    Event       { epoch: u64, generation: u64, event: HubEvent },
    Unavailable { generation: u64 },
}
```

**`ResyncGate` (`gate.rs`, pure).** It owns `epoch` (starts at 0 and only increases) and a state of `Live` or `Resyncing { buffer: Vec<HubEvent>, again: bool }`.
- `begin(generation) -> Action::ListSessions`: epoch += 1, clear the buffer, go to `Resyncing`. Called for each new connection.
- `request_resync() -> Option<Action>`: used for `events.dropped` and for the UI's `session_resync`.
  - From `Live`: epoch += 1, go to `Resyncing`, return `Some(ListSessions)`.
  - From `Resyncing`: set `again = true` and clear the buffer (those events are older than the gap), and return `None`.
- `on_event(e) -> Vec<HubMessage>`: in `Live`, emit `Event{epoch, generation, e}`. In `Resyncing`, buffer it.
- `on_sessions(list) -> (Vec<HubMessage>, Option<Action>)`:
  - If `again`: reset it, clear the buffer, emit nothing and return `Some(ListSessions)`.
  - Otherwise emit `Snapshot{epoch,…}`, then every buffered event in arrival order with the same epoch, then go `Live`.
- Corporate `devices.presence` resync is DT-15. Leave a doc comment on `on_sessions` naming it, not a TODO.

**`EventHub` (`hub.rs`).**

```rust
pub fn start(states: watch::Receiver<DaemonState>, state_dir: PathBuf)
    -> (EventHub, mpsc::UnboundedReceiver<HubMessage>);   // EventHub: Clone
impl EventHub { pub fn resync(&self); }                   // non-blocking; no-op while not connected
```

- On each `Ready` with a new `generation`:
  1. `connect_authenticated(listen, &state_dir)`.
  2. Call `events.subscribe` **before** `session.list`, so no event can fall between them.
  3. Then `gate.begin` → `session.list` on the hub's own client.
  4. Parse `{sessions:[SessionInfo]}` strictly. A bad shape counts as a failed list.
- Run notifications, list results and resync requests through one task, so the gate is never touched concurrently. `session.list` can run concurrently with notifications on the same client. Await it in a spawned future whose result comes back over a channel. Don't block the notification loop.
- When the connection ends, a call fails or a list fails, emit `Unavailable{generation}`, drop the client and retry `connect_authenticated` after 1 s for as long as that generation is still the current `Ready`.
- On `Restarting`, `Failed` or `Stopped`, emit `Unavailable` once, drop the connection and wait for the next `Ready`.
- The hub never calls `session.stop`, `session.connect` or `events.unsubscribe`. Dropping every `EventHub` handle ends the task and closes its connection. It never stops sessions (P17).
- Wrap every send to the UI channel in `let _ =`. A closed receiver must not panic.

**`app/mod.rs`.** After `Supervisor::start`, call `EventHub::start(supervisor.subscribe(), Workspace::Solo.state_dir(&app_data))`. Spawn one task that `emit("session-hub", &msg)` for each message. Keep the `EventHub` in managed state. Add `#[tauri::command] fn session_resync(state)` that calls `hub.resync()` when a hub exists, and otherwise does nothing (NotConfigured). Register it next to `daemon_status`.

**UI (AD-9 still applies: only `src/platform/tauri.ts` imports `@tauri-apps/api`).**

```ts
// clock.ts
export interface Clock { now(): number }            // monotonic ms
export const systemClock: Clock;                    // performance.now()

// sessionStore.ts: mirror HubMessage/HubEvent/SessionInfo exactly (snake_case fields, "kind"/"type" tags)
export type TunnelState =
  | { state: "up"; transport: string }
  | { state: "down"; since: number; reason: string; transport: string }
  | { state: "lost"; reason: string };
export interface LiveSession {
  sessionId: string; deviceId: string; adbAddr: string | null; started: string | null;
  status: "listening" | "up" | "retrying";
  transport: string | null;                          // last path_up transport; null = unknown (DT-06 decides the copy)
  tunnels: Record<string, TunnelState>;
}
export type EndReason = "closed" | "error" | "peer_closed" | "session_expired";
export interface EndedSession { sessionId: string; deviceId: string | null; reason: EndReason; at: number }
export interface SessionStoreState {
  synced: boolean; epoch: number; generation: number | null;
  live: Record<string, LiveSession>; ended: EndedSession[];   // ended: newest first, at most 20
}
export const initialState: SessionStoreState;       // synced false, epoch 0, generation null, empty
export function reduce(s: SessionStoreState, m: HubMessage, now: number): SessionStoreState;   // pure, never mutates
```

Reducer rules:
- `snapshot`:
  - Ignore it if `epoch < s.epoch`.
  - Otherwise `live` becomes exactly the listed sessions, with status "up", transport null and no tunnels. A session that is already live and still listed keeps its transport and tunnels.
  - Set `synced`, `epoch` and `generation`. Keep `ended`.
- `event`:
  - Ignore it unless `synced` and `epoch === s.epoch`.
  - `listening` / `session_up`: upsert by `session`. This is idempotent: tunnels are kept, and status becomes "listening" or "up".
  - `retrying`: a live session becomes "retrying". Otherwise ignore it.
  - `session_down` / `peer_closed` / `session_expired`:
    - A live session is removed and an `EndedSession` is prepended. Use the reason "error" when `abnormal`, else "closed".
    - Any terminal event for a session that isn't live is ignored. A `peer_closed` followed by a `session_down` therefore keeps `peer_closed`.
  - `path_down` / `path_up` / `path_lost`:
    - Ignore them for a session that isn't live, and for a tunnel whose state is already `lost`.
    - `path_down`: set `down{since: now}`.
    - `path_up`: set `up` and the session's `transport`.
    - `path_lost`: set `lost`.
- `unavailable`: `live` becomes `{}` and `synced` false. Keep `ended`, `epoch` and `generation`. This means no stale Connected while the daemon is gone (P21).

```ts
// useSessions.ts
export interface SessionHubPort {
  subscribe(onMessage: (m: HubMessage) => void): Promise<() => void>;
  resync(): Promise<void>;
}
export function useSessions(port: SessionHubPort, clock: Clock): SessionStoreState;
```

`useSessions` subscribes **first**, then calls `resync()` once (a late-loading UI still gets a fresh snapshot: P17 restore). It reduces with `clock.now()` at arrival and unsubscribes on unmount. Use `useReducer` or `useState`, with no state library.

## 4. TDD: write these tests first, see them fail, then implement

- **Rust unit tests (`model.rs`):**
  - Every allowlisted type parses from a §2.2-shaped notification.
  - `audit`, `token_updated`, `pairing_code`, `adb_pair`, `paired` and an unknown `"future_thing"` are `Ignored`.
  - A `path_up` missing `fields.session_id` is `Ignored`, and so is an event with `session: ""`.
  - `session_down` with `fields.error` is `abnormal: true`, and the error text doesn't appear in `serde_json::to_string`.
  - `events.dropped {count: 17}` gives `Dropped{17}`.
  - `serde_json::to_value` shapes for one `Snapshot` and one `Event` (assert `kind`, `type`, field names).
- **Rust unit tests (`gate.rs`):**
  - `Live` passes events through with the current epoch.
  - Resync buffers, then emits Snapshot followed by the buffered events in order, all with the new epoch.
  - `request_resync` during `Resyncing` makes `on_sessions` ask for a second list, and the pre-gap buffer is discarded.
  - Epoch strictly increases across `begin` and resyncs.
- **Rust integration (`tests/event_hub.rs`, FakeDaemon).** Build a `watch` channel by hand with `Ready{ listen: fake.addr(), .. }`. The `client` can come from a second FakeDaemon. Write the token into a tempdir `daemon.token`.
  - Order on the wire: `auth` (with that token), then `events.subscribe`, then `session.list`. Then a `Snapshot` is emitted.
  - **P21:**
    1. After the first snapshot, script a second `session.list` with `reply_delayed` of 300 ms.
    2. Push `events.dropped`, then a `path_up` event.
    3. Assert that nothing is emitted before the second `Snapshot`, that its epoch is higher, and that the `path_up` Event follows it with the same epoch.
  - **P18:** sending `Ready` with generation 2 and a new FakeDaemon gives a new connection, a `Snapshot{generation: 2}` and a higher epoch.
  - `fake.close()` emits `Unavailable`. `Stopped` emits `Unavailable` once and makes no further connection attempt within 1.5 s.
  - **P17:** `hub.resync()` with live sessions emits a fresh snapshot with the same ids. After dropping the hub, `received()` contains no `session.stop` and no `events.unsubscribe`.
  - `connect_authenticated` to `10.0.0.1:7605` returns `Unauthorized` without connecting. A missing token also returns `Unauthorized`.
- **UI (Vitest):**
  - `reduce` table:
    - A snapshot replaces a stale "up" session that isn't in the list.
    - Old-epoch snapshots and events are ignored, as are events while not synced.
    - `session_up` is idempotent.
    - `path_*` for an unknown or ended session is ignored.
    - `path_up` after `path_lost` on the same tunnel is ignored, while a new tunnel id on the same session still applies.
    - `path_up` with transport `lan` after `relay-wss` updates `transport`.
    - `peer_closed` then `session_down` keeps the reason `peer_closed`.
    - `ended` is capped at 20, newest first.
    - `unavailable` clears live sessions and keeps ended ones.
    - The input state is never mutated (`Object.freeze` the input).
  - `path_down` stamps `since` from the `now` argument.
  - `useSessions` with a fake port and fake clock:
    - `subscribe` is called before `resync`.
    - Messages pushed through the port reduce into the returned state.
    - Unmount calls the unsubscribe function.
  - `App` shows "No live sessions" and then "1 live session" after a snapshot from the fake port.

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

Also run `npm run tauri dev` once with `SETU_RELAY_URL` and `SETU_DAEMON_PATH` pointing at a real `setu-daemon` v1.1.0. Confirm in the PR that the line shows "No live sessions" once the daemon is ready. If you can pair a phone, also confirm "1 live session". If you can't, say so; it isn't required. Name the OS.

Use no `#[allow(...)]`, no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no `unwrap()`/`expect()` outside tests, and no clippy or lint downgrades. If a gate fails for a reason you can't fix in code, stop and report the exact error.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** The token, the daemon connection and the raw event JSON stay in Rust. React sees only `HubMessage` through one event and one command (AD-9, AD-11). The ordering guarantee (snapshot before held events) lives in the Rust gate. The reducer is a second, pure line of defence (epoch and liveness checks), not the place where ordering is decided.
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. If the daemon's real event shapes differ from §1.5 or §2.2 (check `core/internal/daemon` at `v1.1.0` if unsure), follow the daemon, record it there, and stop only if it changes the contract above.
2. **Simplicity first.** One hub task and one gate. No generic event bus, no trait objects for the sink (an mpsc receiver is the seam), no state library, no selectors, no memoization helpers. Keep files under ~250–300 lines.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-03b-event-hub`. Make atomic conventional commits:
   - `refactor(desktop): …` for `Ready.listen` and `connect_authenticated`, with existing tests green
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first, then the implementation. Paste the red excerpt and the full green output of every gate in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-03b event hub and session store`, with this body:

```
Ticket: DT-03b (docs/TDD_TICKETS.md §5) · Acceptance: P21, P18 re-list, P17 restore, P14 (stale session/tunnel ignored)

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<full green output of every gate>
<tauri dev manual check: daemon ready, "No live sessions" (and "1 live session" if a phone was paired)>

## Out of scope (left for later tickets)
- pairing form and cancel (DT-04), session card and transport copy (DT-06), rejoin timing and banners (DT-07), tray and quit (DT-09), corporate devices.presence resync (DT-15), end-state copy (DT-16)
```

Then **stop immediately**. Don't start DT-04, don't edit `docs/`, and don't merge.
