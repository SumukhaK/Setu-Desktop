# Builder prompt · DT-05 · Local ADB adapter

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-12). This ticket adds AD-13 (§3). The reviewer writes it into memory after merge.
2. `docs/TDD_TICKETS.md` §4 (stack) and §5 "DT-05".
3. `docs/JOURNEYS.md`: the "Integration" step about **Connect ADB**, and row P09. This ticket covers only the ADB half of P09; transport and path are DT-06.
4. `docs/SCREENS.md` row D04: ADB is a separate fact from the listener.
5. The ADB host protocol (`host:track-devices-l`, 4-hex length framing, `OKAY`/`FAIL`): https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/docs/dev/protocol.md and `SERVICES.TXT` in the same repo. Also the `adb connect` CLI: https://developer.android.com/tools/adb
6. Existing code you'll use: `src-tauri/src/app/mod.rs` (`mod shell`), `src/state/useSessions.ts` (`LiveSession.adbAddr`), `src/platform/tauri.ts`, `src/daemon/status.ts` (the subscribe-then-read hook pattern).

## 1. Goal

The app watches the local ADB server at `127.0.0.1:5037` with `host:track-devices-l` and pushes a secret-free snapshot of **loopback** ADB devices to the UI. Under each live session, the UI shows that session's loopback address and its ADB state, matched by **exact** serial:
- `device` → "ADB attached"
- `unauthorized` → "Allow USB debugging on the phone"
- `offline` → "ADB sees the phone offline. Try Connect ADB again."
- not listed → "ADB not attached"
- ADB server unreachable → "ADB server isn't running"

A **Connect ADB** button runs `adb connect <adb_addr>` in Rust. The session line stays visible whatever ADB says (listener independence, P09). If the ADB server restarts, the watcher reconnects by itself. There's no session card or transport (DT-06), no rejoin banners (DT-07), no Diagnostics page (DT-11), no styling, and no change to the prototype.

## 2. Files (create or change only these)

```
src-tauri/Cargo.toml                       + [[bin]] fake-adb (tests/support/fake_adb.rs, test = false, doc = false)
src-tauri/src/lib.rs                       + pub mod adb;
src-tauri/src/adb/mod.rs                   re-exports
src-tauri/src/adb/protocol.rs              encode_request, FrameReader, parse_device_list, is_loopback_serial (pure)
src-tauri/src/adb/track.rs                 AdbSnapshot, AdbDevice, start(server) -> (AdbWatcher, watch::Receiver<AdbSnapshot>)
src-tauri/src/adb/connect.rs               resolve_adb_path, resolve_adb_server, AdbConnectOutcome, parse_connect_output, adb_connect
src-tauri/tests/support/fake_adb_server.rs FakeAdbServer (below)
src-tauri/tests/support/fake_adb.rs        fake `adb` binary driven by env vars
src-tauri/tests/adb_track.rs
src-tauri/tests/adb_connect.rs
src-tauri/src/app/mod.rs                   inside `mod shell`: start the watcher, emit "adb-status", commands adb_status and adb_connect
src/features/adb/adbStatus.ts              AdbSnapshot mirror, AdbPort, AdbConnectOutcome mirror, attachmentOf(), attachmentLabel(), connectMessage()
src/features/adb/adbStatus.test.ts
src/features/adb/useAdbStatus.ts           subscribe first, then current(); a pushed value wins
src/features/adb/useAdbStatus.test.tsx
src/features/adb/SessionAdbLine.tsx        one live session: "<adb_addr> · <label>" + Connect ADB
src/features/adb/SessionAdbLine.test.tsx
src/platform/tauri.ts                      + tauriAdbPort (still the only @tauri-apps/api import)
src/App.tsx, src/main.tsx, src/App.test.tsx render <SessionAdbLine/> per live session under the session count
```

Don't change `src-tauri/src/rpc/`, `daemon/`, `events/`, `commands/`, `src/state/`, `src/features/pair/`, `docs/`, `README.md` or the prototype. Add no crate and no npm package.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**AD-13: local ADB is observed, never trusted from the UI.**
- Only loopback serials cross the bridge: `127.0.0.1:<port>`, `[::1]:<port>` or `localhost:<port>`. USB serials and emulator names never leave Rust.
- `adb connect` runs only in Rust, and only for a loopback `SocketAddr`.
- Attachment is decided only by an exact serial match with state `device`.

**Protocol (`protocol.rs`, pure).**
- `encode_request(service: &str) -> Vec<u8>`: a 4-digit lowercase hex length, then the bytes. For example, `"0014host:track-devices-l"`.
- `FrameReader`: feed bytes and get back complete payloads. Each payload is a 4-hex-digit length followed by that many bytes, and an empty payload (`"0000"`) is valid. A non-hex length is a protocol error, which closes the connection.
- `parse_device_list(payload: &str) -> Vec<AdbDevice>`:
  - Each non-empty line is split on ASCII whitespace. Token 0 is the serial and token 1 is the state.
  - States are raw adb tokens: `device`, `unauthorized`, `offline`, `authorizing`, `connecting`, `no` (from "no permissions"), and so on.
  - Lines with fewer than 2 tokens are skipped.
  - Only loopback serials are kept (`is_loopback_serial`).

**Watcher (`track.rs`).**

```rust
#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct AdbDevice { pub serial: String, pub state: String }

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "server", rename_all = "snake_case")]
pub enum AdbSnapshot { Unknown, Down, Up { devices: Vec<AdbDevice> } }   // devices sorted by serial

pub fn start(server: SocketAddr) -> (AdbWatcher, watch::Receiver<AdbSnapshot>);   // AdbWatcher: Clone; dropping every handle ends the task
```

The watcher loop:
1. Connect to `server`.
2. Write `encode_request("host:track-devices-l")` and read 4 bytes.
   - `OKAY`: continue.
   - `FAIL`, or anything else, counts as a failure.
3. For every payload, publish `Up{devices}` with `send_if_modified`, so an identical list doesn't wake the UI.
4. On a connect failure, EOF or protocol error, publish `Down` and retry. The backoff starts at 500 ms, doubles and caps at 5 s, and resets after an `OKAY`.

The watcher never starts an ADB server. `resolve_adb_server(env_port: Option<String>) -> SocketAddr` returns `127.0.0.1:<ANDROID_ADB_SERVER_PORT>` when that's a valid u16, else `127.0.0.1:5037`.

**Connect (`connect.rs`).**

```rust
#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum AdbConnectOutcome { Connected, NotLoopback, Missing, TimedOut, Failed { detail: String } }

pub fn resolve_adb_path(env_override: Option<OsString>) -> PathBuf;   // non-empty SETU_ADB_PATH, else "adb" (PATH lookup)
pub fn parse_connect_output(stdout: &str, stderr: &str) -> Result<(), String>;
pub async fn adb_connect(adb: &Path, addr: &str, timeout: Duration) -> AdbConnectOutcome;
```

- `parse_connect_output`:
  - Returns `Ok` iff any line of `stdout` (trimmed) starts with `connected to ` or `already connected to `. `adb` often exits 0 even on failure, so don't trust the exit code.
  - Otherwise returns `Err(detail)`. `detail` is the first non-empty trimmed line of stdout, then of stderr, else `"adb connect failed"`, cut to 200 chars.
- `adb_connect` handles these cases in order:
  1. `addr` must parse as a `SocketAddr` with a loopback IP. Otherwise return `NotLoopback` without spawning anything.
  2. Spawn `adb connect <addr>` with `tokio::process::Command`, stdin null, piped stdout and stderr, and `kill_on_drop(true)`. This is fine here: `adb connect` is short-lived, unlike the daemon.
  3. A spawn `NotFound` returns `Missing`.
  4. If it takes longer than `timeout` (the app uses 10 s), return `TimedOut`. The child is killed.
  5. Otherwise parse the output.

**App shell.**
- In setup, always start the watcher (it doesn't need a relay) with `resolve_adb_server(env ANDROID_ADB_SERVER_PORT)`.
- Keep `AdbWatcher` and the receiver in `AppState`.
- Spawn one forwarder that emits `"adb-status"` with the snapshot on each change, starting with the current value.
- `#[tauri::command] fn adb_status(state) -> AdbSnapshot` returns the current value.
- `#[tauri::command] async fn adb_connect(adb_addr: String) -> Result<AdbConnectOutcome, String>` calls `adb_connect(&resolve_adb_path(env SETU_ADB_PATH), &adb_addr, 10 s)` and always returns `Ok`.
- Register both next to the existing commands.

**UI (AD-9).**

```ts
export type AdbSnapshot =
  | { server: "unknown" } | { server: "down" }
  | { server: "up"; devices: { serial: string; state: string }[] };
export type AdbConnectOutcome =
  | { outcome: "connected" } | { outcome: "not_loopback" } | { outcome: "missing" }
  | { outcome: "timed_out" } | { outcome: "failed"; detail: string };
export interface AdbPort {
  current(): Promise<AdbSnapshot>;
  subscribe(cb: (s: AdbSnapshot) => void): Promise<() => void>;
  connect(adbAddr: string): Promise<AdbConnectOutcome>;
}
export type Attachment = "attached" | "unauthorized" | "offline" | "absent" | "server_down" | "unknown" | "other";
export function attachmentOf(adbAddr: string | null, s: AdbSnapshot | null): Attachment;
export function attachmentLabel(a: Attachment): string;
export function connectMessage(o: AdbConnectOutcome): string | null;   // null for connected
```

- `attachmentOf`:
  - A null snapshot or `unknown` gives `"unknown"`.
  - `down` gives `"server_down"`.
  - A null `adbAddr` gives `"absent"`.
  - Otherwise use the device whose `serial === adbAddr` (strict equality, no trimming, no prefix match). Its state `device`, `unauthorized` or `offline` maps directly, and any other state gives `"other"`.
  - No match gives `"absent"`.
- Labels are the §1 strings, plus `unknown` → "Checking ADB…" and `other` → "ADB is still connecting to the phone".
- `connectMessage` copy:
  - `missing`: "Android Platform Tools (adb) weren't found. Install them or set SETU_ADB_PATH."
  - `timed_out`: "adb connect didn't answer in 10 seconds. Try again."
  - `not_loopback`: "Setu only connects ADB to this computer's loopback address."
  - `failed`: "adb connect failed: <detail>"
- `SessionAdbLine({ session, adb, port })` shows `<adbAddr ?? "Address pending"> · <label>`.
  - **Connect ADB** is shown when the attachment isn't `attached`, `unknown` or `server_down`, and `adbAddr` isn't null. It's disabled while a connect is running.
  - A non-null `connectMessage` goes in `role="alert"`.
  - After `connected`, show nothing extra. The watcher's next snapshot flips the label.
- `App` renders one `SessionAdbLine` per `sessions.live` entry, keyed by `sessionId`, and uses `useAdbStatus(adbPort)` once.

## 4. TDD: write these tests first, see them fail, then implement

- **`protocol.rs` unit tests:**
  - `encode_request` bytes.
  - `FrameReader` handles a split length, a split payload, two frames in one chunk, `"0000"`, and a non-hex length as an error.
  - `parse_device_list` handles the `-l` long format (`"127.0.0.1:41377  device product:x model:Pixel_7 device:panther transport_id:3"`), tab-separated lines, `no permissions`, and blank lines. USB (`"R58M123ABC device"`) and `emulator-5554` are dropped. `127.0.0.1:41377`, `[::1]:5555` and `localhost:5555` are kept.
- **`tests/adb_track.rs` (FakeAdbServer):**
  - The request is exactly `0014host:track-devices-l`.
  - **P09 sequence:** push `""`, then `unauthorized`, `offline` and `device` lines for `127.0.0.1:41377`. Snapshots arrive in that order, and a repeated identical payload produces no extra change.
  - A `127.0.0.1:4137` / `127.0.0.1:413770` neighbour appears as its own serial, so it isn't merged with the session's.
  - `FAIL` leads to `Down`.
  - **Restart:** `close()` gives `Down`. The watcher reconnects within 1.5 s and publishes `Up` from the new connection's first payload.
  - With no server listening, the snapshot is `Down` and no panic happens.
  - Dropping the `AdbWatcher` ends the task, so the server sees the connection close.
- **`tests/adb_connect.rs`** (the `fake-adb` bin reads `FAKE_ADB_STDOUT`, `FAKE_ADB_STDERR`, `FAKE_ADB_EXIT` and `FAKE_ADB_SLEEP_MS`, and writes its argv to `FAKE_ADB_ARGS_FILE`):
  - "connected to 127.0.0.1:41377" → `Connected`, and the argv is exactly `["connect","127.0.0.1:41377"]`.
  - "already connected to …" → `Connected`.
  - "failed to connect to …" with exit 0 → `Failed{detail}`, with the detail at most 200 chars.
  - A sleep past the timeout (use 300 ms in the test) → `TimedOut`.
  - A nonexistent path → `Missing`.
  - `"10.0.0.2:5555"` and `"pixel-7"` → `NotLoopback`, and the args file isn't created.
  - Unit tests for `resolve_adb_path`, `resolve_adb_server` and `parse_connect_output`.
- **UI (Vitest, with a fake `AdbPort`):**
  - `attachmentOf` table: every state, server down, unknown, a null address, an exact match versus `127.0.0.1:4137` and `127.0.0.1:413770`, and a `" 127.0.0.1:41377"` with a leading space, which doesn't match.
  - Every label and every `connectMessage` string.
  - `useAdbStatus`: subscribe happens before `current()`, a pushed snapshot beats a late `current()`, and unmount unsubscribes.
  - `SessionAdbLine`: walk absent → unauthorized → offline → device by pushing snapshots. The label changes each time, and **Connect ADB** disappears at attached. Clicking it calls `port.connect("127.0.0.1:41377")` once and shows each outcome's copy.
  - **App:** with ADB `down`, the live session line is still rendered with "ADB server isn't running" (listener independence).

**FakeAdbServer** (`tests/support/fake_adb_server.rs`):
- `start()` binds `127.0.0.1:0` and accepts connections one after another.
- `addr()`.
- `requests()` gives the raw request strings received.
- `reply_fail()` answers the next request with `FAIL` + framed message.
- `push(payload)` frames and sends the payload on the current connection.
- `close()` drops the current connection and keeps listening.
- `wait_for_connections(n)`.

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

Also run `npm run tauri dev` once with Platform Tools installed.
1. Confirm "ADB server isn't running" after `adb kill-server`.
2. Confirm it recovers after `adb start-server` without restarting the app.
3. With a real paired session if you have one: **Connect ADB** → "ADB attached".
4. Without a phone, run `adb connect 127.0.0.1:1` by hand to show that the failure copy appears.
5. Name the OS.

Use no `#[allow(...)]`, no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no `unwrap()` or `expect()` outside tests, and no clippy or lint downgrades. If a gate fails for a reason you can't fix in code, stop and report the exact error.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** Sockets, process spawning, adb output parsing and the loopback filter stay in Rust. React gets a loopback-only snapshot and a typed outcome. It never sends anything to adb except an address that Rust re-validates.
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. If real `adb` output or the track-devices format differs from §3 on your machine, follow the real behaviour, add a test for it and record it.
2. **Simplicity first.** One watcher task, one connect function. No adb client crate, no device-list UI, no polling of `adb devices` (track-devices pushes). Keep files under ~250–300 lines.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-05-local-adb`. Make atomic conventional commits:
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first, then the implementation. Paste the red excerpt and the full green output of every gate in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-05 local ADB adapter`, with this body:

```
Ticket: DT-05 (docs/TDD_TICKETS.md §5) · Acceptance: P09 (ADB half: absent → unauthorized → offline → device, exact serial, listener independent)

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<full green output of every gate>
<tauri dev manual check: kill-server → "ADB server isn't running", start-server → recovers, Connect ADB result>

## Out of scope (left for later tickets)
- session card, transport and path (DT-06), rejoin banners (DT-07), Diagnostics page and doctor adb check (DT-11), sidecar adb bundling (DT-17)
```

Then **stop immediately**. Don't start DT-06, don't edit `docs/`, and don't merge.
