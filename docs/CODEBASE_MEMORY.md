# Setu-Desktop · codebase memory

Read this first. It replaces a repo scan. Keep it under 150 lines; update it in every post-merge ritual.

Last updated: 2026-11-25 · main @ `1a140de` (UK-04 merged, DT-10 prompt issued) · SDK baseline: Setu-SDK v1.1.0 (`SumukhaK/Setu` tag `v1.1.0`, commit `921aded`)

## Pipeline

- Architect/reviewer: Claude. Builders: one ticket per PR from `docs/TDD_TICKETS.md`, branch from latest `main`.
- Active builder prompt: `docs/prompts/CURRENT_TASK.md`. Review fixes: `docs/REVIEW_FIX_PROMPT.md` (exists only while a PR needs changes).
- Acceptance tests: `docs/JOURNEYS.md` P01–P22 (canonical for both repos). Screens: `docs/SCREENS.md` D01–D10.
- SDK contract: https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md (§2 daemon JSON-RPC, §2.3 error table, §1.5 events). Daemon source: `core/internal/daemon/cmd.go` (flags, ready line, token file).
- CI (`.github/workflows/ci.yml`, UK-01): gates-linux, gates-windows (MSVC, LF checkout) and e2e-linux (builds `setu` + `setu-daemon` from SDK tag v1.1.0, runs `tests/e2e_real_daemon.rs` with `SETU_E2E_BIN_DIR`). All three must be green before merge.

## Stack (fixed in TDD_TICKETS.md §4)

- Tauri v2. Rust native core in `src-tauri/`; React + Vite + TypeScript (`strict: true`, no `any`) UI in `src/`.
- Rust gates: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (run from `src-tauri/`).
- UI gates (repo root): `npm ci`, `npm run typecheck`, `lint`, `format:check`, `test` (Vitest + Testing Library, jsdom), `build`.
- UI reaches the daemon only through Tauri commands. Tokens, pairing codes and process control stay in Rust.
- Rust deps: tauri 2, tauri-plugin-single-instance 2, tokio (rt, net, io-util, sync, macros, time, process), serde, serde_json, thiserror; build: tauri-build 2, embed-resource 3 (Windows test manifest); dev: tempfile. No logging crate.
- npm: React 19 + Vite + TypeScript, @tauri-apps/api + cli, Vitest, Testing Library, ESLint flat config (typescript-eslint strictTypeChecked, react-hooks), Prettier. No UI kit, router or state library.

## Directory map

```
README.md  index.html  styles.css      prototype (fixtures, not app code)
package.json vite.config.ts tsconfig.json eslint.config.js .prettierrc.json
src/                                   React UI (Vite root; AD-9)
  index.html main.tsx App.tsx          App: page state (workspace|devices), hooks + pairing open flag stay here; main.tsx imports styles/app.css
  app/                                 Shell (chrome, rail, aria-current nav, focus h1), Icon, WorkspacePage (+ Move to tray), DevicesPage, QuitConfirm, windowLifecycle (WindowPort); styles/app.css = prototype tokens
  daemon/status.ts StatusStrip.tsx     DaemonStatus, DaemonPort, statusLabel(), useDaemonStatus(port); strip is role="status", "Checking…" until first status
  features/adb/                       adbStatus (AdbSnapshot mirror, attachmentOf exact serial, labels), useAdbStatus, SessionAdbLine (+ Connect ADB)
  features/pair/                      codeFormat.parseCodeInput, pairPort (ConnectOutcome mirror, outcomeMessage), PairDialog (draft held in App, unmount cancels a pending connect)
  features/devices/                  devicesPort (List/Forget/Nickname outcome mirrors, messages), DeviceList (request counter), DeviceDetail (inline forget confirm)
  features/session/                   transport (transportOf path>audit>unknown, transportLabel), StatusStrip, sessionPort (StopOutcome, stopMessage), SessionCard(clock), rejoinMachine (rejoinViewOf, nextWakeAt), RejoinBanner, EndedNotice (UK-03)
  state/                               clock (Clock, systemClock), sessionStore (HubMessage mirrors, pure reduce(state, msg, now)), useSessions(port, clock): subscribe, then resync()
  platform/tauri.ts                    tauriDaemonPort, tauriSessionHubPort, tauriSessionPort: the only @tauri-apps/api import
src-tauri/                             lib `setu_desktop` + bin `setu-desktop` (default-run) + bin `fake-setu-daemon`
  Cargo.toml Cargo.lock build.rs       build.rs: tauri_build + Windows test manifest / WebView2Loader.dll copy (GNU)
  tauri.conf.json capabilities/ icons/ one "main" window "Setu", strict CSP (+ dev-only devCsp, UK-02), bundle inactive, no externalBin
  src/lib.rs                           pub mod adb; app; commands; daemon; events; rpc; store;
  src/app/mod.rs tray.rs               #[cfg(not(test))] shell: single-instance, close→hide, window_hide, app_quit (QuitLatch, end sessions ≤5 s, Supervisor::stop, exit); tray Show/Quit, show_main = restore + hub.resync()
  src/app/status.rs                    AppStatus, status_of, resolve_daemon_path, resolve_relay (+ unit tests)
  src/adb/protocol.rs                  encode_request, FrameReader (4-hex framing), parse_device_list, is_loopback_serial
  src/adb/track.rs                     watcher: host:track-devices-l, AdbSnapshot Unknown|Down|Up{devices}, backoff 0.5→5 s, never starts adb
  src/adb/connect.rs                   resolve_adb_path (SETU_ADB_PATH|adb), resolve_adb_server (ANDROID_ADB_SERVER_PORT|5037), adb_connect → AdbConnectOutcome
  tests/adb_track.rs tests/adb_connect.rs  7 + 6 tests; support: fake_adb_server.rs, fake_adb.rs ([[bin]] fake-adb)
  src/store/nicknames.rs               NicknameStore (AD-14), normalize_nickname → InvalidNickname
  src/commands/devices.rs              DeviceRow, List/Forget/NicknameOutcome, valid_device_id, list_devices, forget_device, set_nickname
  src/commands/session.rs quit.rs      PairingCode (no Debug), ConnectOutcome, PendingConnect slot (token, sender), connect_with_code/device, cancel_pending, StopOutcome, stop_session; quit: end_all_sessions (list + stop each, NoSession = stopped) → QuitOutcome, QuitLatch
  tests/e2e_real_daemon.rs            real relay + phone agent + daemon; skips without SETU_E2E_BIN_DIR. Hold one adb_addr stream open across an outage: path events are per tunnel
  tests/session_commands.rs quit_commands.rs  12 + 8 tests (pairing P02/P19, stop P17, no code leak; Quit ends all, latch)
  src/events/model.rs                  SessionInfo, HubEvent (10-type allowlist incl. audit_session_start), HubMessage, parse_notification, parse_session_list
  src/events/gate.rs                   ResyncGate: epoch, Live | Resyncing{buffer, again}
  src/events/hub.rs                    EventHub task: dedicated connection, subscribe → list → ordered forward, 1 s retry; tests/event_hub.rs: 9 (wire order, P21, P18, P17, close, auth)
  src/rpc/framing.rs client.rs         encode(), LineDecoder (1 MiB cap); RpcClient, Notification, VersionInfo
  src/rpc/errors.rs                    SetuError, from_error_object()
  tests/rpc_client.rs                  13 client tests (order, busy, notifications, disconnect, drop)
  tests/support/fake_daemon.rs         FakeDaemon: in-process JSON-RPC line server on 127.0.0.1:0
  src/daemon/workspace.rs              Workspace (Solo | Corporate{org_slug}), state_dir(), attach record r/w (AD-7)
  src/daemon/config.rs                 DaemonConfig + CorporateFlags, to_args() (no Debug: proxy creds)
  src/daemon/ready_line.rs             parse() daemon_ready: loopback listen, version >= 1.1.0
  src/daemon/supervisor.rs             Supervisor: attach-or-spawn, auth, restart backoff, Failed after 5, stop()
  tests/daemon_supervisor.rs           9 supervisor tests (P18 spawn/attach/stale/crash/timeout, P17 stop/drop/runtime shutdown, non-loopback record)
  tests/support/fake_setu_daemon.rs    [[bin]] fake-setu-daemon (FAKE_DAEMON_EXIT_AFTER_MS, _NO_READY, _ARGS_FILE)
docs/  JOURNEYS SCREENS TDD_TICKETS CODEBASE_MEMORY prompts/ previews/ walkthrough/
```

## Key public interfaces

- `rpc::RpcClient::connect(addr: SocketAddr) -> Result<(RpcClient, UnboundedReceiver<Notification>), SetuError>`. `RpcClient` is `Clone + Send + Sync`. Dropping the last clone closes the socket and ends the notification channel.
- `RpcClient::call(&self, method: &str, params: Option<Value>) -> Result<Value, SetuError>`: u64 ids from 1, out-of-order safe, one `-32027` retry after 100 ms.
- `RpcClient::call_cancellable(method, params, oneshot::Receiver<()>)`: on cancel sends `session.cancel {request_id: <own id>}` on the same connection and keeps awaiting the reply (→ `Cancelled`); cancel during busy back-off returns `Cancelled` without the retry (AD-12).
- `RpcClient::auth(&self, token: &str) -> Result<(), SetuError>` (expects `{ok:true}`); `RpcClient::version() -> Result<VersionInfo { version, mode, audit }, SetuError>`.
- `rpc::Notification { method: String, params: Value }` (no `Debug`, on purpose: AD-5).
- `rpc::SetuError`: `Protocol{code,message}`, `Unauthorized`, `Denied{code,kind,message}` (−32010 and every unknown code; `kind` is `""` when absent), `Unavailable`, `NotPaired`, `BadCode`, `Revoked`, `TokenInvalid`, `TokenExpired`, `NoGrant`, `Blocked`, `NoSession`, `AuditDisabled`, `Cancelled`, `AdbPairFailed`, `Unsupported`, `SessionExpired`, `PeerClosed`, `Busy`, plus client-side `FrameTooLarge`, `Disconnected`, `Io` (connect only), `UnexpectedResult`. `code() -> Option<i64>`.
- `rpc::from_error_object(&Value) -> SetuError` (missing code → `Protocol{-32603}`); `rpc::encode`, `rpc::LineDecoder::feed(&[u8]) -> Result<Vec<Vec<u8>>, SetuError>`.
- `daemon::Supervisor::start(workspace, app_data, DaemonConfig, SupervisorOptions) -> Supervisor` (Clone; returns at once). `subscribe() -> watch::Receiver<DaemonState>`; `async stop()`. `DaemonState = Starting | Ready{client: RpcClient, generation (from 1), pid, attached} | Restarting{attempt, retry_in} | Failed{reason} | Stopped` (no Debug). Dropping a Supervisor or its runtime never kills the daemon (P17). The child is a `std::process::Child`; stdout is drained on a dedicated OS thread.
- `daemon::Workspace::corporate(slug)` validates `[a-z0-9-]{1,63}`, no leading `-`. `read_attach_record` / `write_attach_record` (atomic) / `remove_attach_record`. Attach only to loopback records.
- `app::status::AppStatus` (serde tag `state`, snake_case): `NotConfigured | Starting | Ready{version: Option<String>, attached, generation} | Restarting{attempt, retry_in_ms} | Failed{reason} | Stopped`. Native → UI: `invoke("daemon_status")` + event `"daemon-status"`.
- `app::run()` (not in unit-test builds): starts the Solo supervisor when `SETU_RELAY_URL` resolves, label from `COMPUTERNAME`/`HOSTNAME`, keeps the `Supervisor` in managed state, never stops it on close.
- `daemon::connect_authenticated(listen, &state_dir) -> Result<(RpcClient, Receiver<Notification>), SetuError>`: loopback only, token from `<state>/daemon.token`; else `Unauthorized`. `DaemonState::Ready` now has `listen: SocketAddr`.
- `events::start(watch::Receiver<DaemonState>, state_dir) -> (EventHub, UnboundedReceiver<HubMessage>)`; `EventHub::resync()`. `HubMessage` (tag `kind`): `Snapshot{epoch, generation, sessions}` | `Event{epoch, generation, event}` | `Unavailable{generation}`. `HubEvent` (tag `type`): listening, session_up, retrying, session_down{abnormal}, path_down/up/lost{tunnel_id}, session_expired, peer_closed, audit_session_start{device_id, tunnel_id, transport}. Native → UI: event `"session-hub"` + command `session_resync`.
- UI store: snapshot replaces `live` (epoch must not go back); events need `synced` and the same epoch; terminal events move a live session to `ended` (max 20, first reason wins); path events for non-live sessions or `lost` tunnels are ignored; `unavailable` clears `live`. `audit_session_start` sets `auditTransport` only on exactly one live session with that device. Tunnel states: up{at} | down{since} (a repeated path_down keeps since) | lost{at}.
- Pairing: commands `session_connect_code(code) -> ConnectOutcome` (tag `outcome`: connected | malformed | not_ready | already_pending | bad_code | unavailable | cancelled | failed{code}) and `session_cancel_connect() -> bool`; client = current `Ready.client`. Rust re-validates `^\d{4}-\d{6}$`. `session_stop(session_id) -> StopOutcome` (stopped | no_session | not_ready | invalid | failed{code}); Rust validates `^s[0-9]{1,9}$`. DT-08: `session_connect_device(device_id)` (same slot; + not_paired, revoked), `devices_list`, `devices_forget`, `device_set_nickname`.
- ADB: event `"adb-status"` + commands `adb_status` / `adb_connect(adb_addr) -> AdbConnectOutcome` (connected | not_loopback | missing | timed_out | failed{detail ≤200}). The watcher runs even without a relay.
- UI: `DaemonPort { current(), subscribe(cb) → Promise<unsubscribe> }`; `useDaemonStatus` subscribes first, a pushed status beats a late `current()`.
- Test support: `FakeDaemon::start()`, `addr()`, `received()`, `wait_for_requests(n)`, `reply_with`, `reply_with_error`, delayed/reversed replies, `send_raw`, notifications, `close()`. Unscripted methods get `-32601`.

## Wired SDK v1.1.0 bindings

| RPC / event | Wired in | Ticket |
| --- | --- | --- |
| JSON-RPC framing, ids, concurrency, `-32027` retry | `rpc::client` | DT-01 |
| §2.3 error table (−32700..−32603, −32001, −32010..−32027) | `rpc::errors` | DT-01 |
| `auth {token}`, `version` | `RpcClient::auth`, `RpcClient::version` | DT-01 |
| `event`, `events.dropped` notifications (raw) | `Notification` channel | DT-01 |
| daemon flags §2, `daemon_ready`, `daemon.token` | `daemon::{config, ready_line, supervisor}` | DT-02 |
| `version` shown in the status strip once Ready | `app::shell` forwarder → `AppStatus::Ready.version` | DT-03a |
| ADB host `host:track-devices-l`, `adb connect <adb_addr>` | `adb::{protocol, track, connect}` → `features/adb` | DT-05 |
| `session.connect {pairing_code, timeout_ms}`, `session.cancel {request_id}` | `rpc::call_cancellable`, `commands::session`, `features/pair` | DT-04 |
| `events.subscribe`, `event`, `events.dropped`, `session.list` | `events::{hub, gate, model}` → `src/state/sessionStore.ts` | DT-03b |
| `session.stop`, audit `session_start` (transport fallback), `path_up` transport | `commands::session`, `events::model` → `features/session` | DT-06 |
| `devices.list`, `devices.forget`, `session.connect {device_id}` | `commands::devices`, `connect_with_device` → `features/devices` | DT-08 |
| `path_down` / `path_up` / `path_lost` banners (holding ≥ 10 s, lost only from the SDK) | `features/session/{rejoinMachine, RejoinBanner}` | DT-07 |

## Architecture decisions (binding on builders)

- AD-1: `src-tauri` keeps the lib target `setu_desktop`; the Tauri app binary is `setu-desktop` (DT-03a). Tauri code lives only in `app/` (the `shell` module is `#[cfg(not(test))]`, so lib unit tests stay GUI-free); `daemon/` and `rpc/` never import tauri.
- AD-2: RPC errors map by numeric `code`; `data.kind` is kept for display/logs. Unknown server codes become `SetuError::Denied`. Never guess a specific error.
- AD-3: Any framing or protocol violation (line over 1 MiB, invalid JSON, EOF, write failure) closes the connection and fails every pending call with `Disconnected`. Dropping the last `RpcClient` also closes it. The DT-02 supervisor owns reconnecting.
- AD-4: `-32027 busy` is retried once inside the client after 100 ms. A second busy is returned.
- AD-5: Never log or persist secrets (`auth.token`, `pairing_code`, JWTs, proxy credentials). Types that can hold them don't derive `Debug`, or redact it. DT-10 adds the redaction layer.
- AD-6 (DT-02): The supervisor takes the daemon executable path as input. Bundling `setu-daemon` as a Tauri sidecar (`tauri.conf.json` `externalBin`) moves to DT-17 (AD-8).
- AD-8 (DT-03a): No sidecar yet. Tauri v2 `externalBin` fails the build when `binaries/setu-daemon-<triple>` is missing, so the app resolves the daemon at runtime: `SETU_DAEMON_PATH` if set, else `setu-daemon[.exe]` next to the app executable. DT-17 adds the checksummed fetch and the sidecar. The Solo relay URL comes from `SETU_RELAY_URL` (runtime env, then compile-time `option_env!`) until DT-12; without one the app shows "No relay configured" and starts no supervisor.
- AD-9 (DT-03a): UI ports. React code never imports `@tauri-apps/api` outside `src/platform/tauri.ts`; features take a typed port (`DaemonPort`) so Vitest uses a fake. Native → UI state is pushed as Tauri events plus one initial `invoke` read; payloads are plain serde structs that can't hold secrets.
- AD-10 (DT-03b): The supervisor's connection is the liveness probe and never subscribes. The event hub opens its own authenticated connection (`connect_authenticated`), calls `events.subscribe` before `session.list`, and the Rust `ResyncGate` holds events until the snapshot (P21). The UI reducer's epoch/liveness checks are a second line of defence, not the ordering mechanism.
- AD-11 (DT-03b): Raw daemon events never cross the bridge. Only the typed `HubEvent` allowlist does; unknown, malformed and secret-bearing types (`audit`, `token_updated`, `pairing_code`, …) are dropped, and error strings are never forwarded. DT-06 allows one audit shape: `audit_session_start{device_id, tunnel_id, transport}` (desktop role, 16-hex tunnel, known transport); `user`/`token_id` never cross.
- AD-12 (DT-04): JSON-RPC ids never leave `rpc/`. Cancellation is a signal into `call_cancellable`, which cancels its own in-flight id on the same connection.
- AD-13 (DT-05): Local ADB is observed, never trusted from the UI. Only loopback serials cross the bridge; `adb connect` runs only in Rust for a loopback `SocketAddr`; attachment = exact serial match in state `device`.
- AD-14 (DT-08): nicknames are a desktop-only JSON file `<state_dir>/desktop-nicknames.json` (`{version:1, nicknames:{<exact id>: name}}`, atomic write, corrupt → empty), not SQLite. Ids are byte-exact and never normalised; nicknames never reach the daemon.
- AD-7 (DT-02): `setu-daemon` v1.1.0 has no single-instance guard per state dir. The app records the live daemon in `<state>/desktop-daemon.json` (`listen`, `pid`, `version`; no secrets). On start it attaches when that address authenticates with `<state>/daemon.token`, else it spawns.

## Completed tickets

| Ticket | PR | Summary |
| --- | --- | --- |
| DT-01 | [#3](https://github.com/SumukhaK/Setu-Desktop/pull/3) | JSON-RPC client core, full error table, framing, busy retry, FakeDaemon. One review round (connection leak on drop, fixed). |
| DT-02 | [#6](https://github.com/SumukhaK/Setu-Desktop/pull/6) | Daemon supervisor, workspaces, attach record, ready line, fake daemon bin. One review round (`kill_on_drop` broke P17; token could go to a non-loopback record). |
| UK-04 | [#35](https://github.com/SumukhaK/Setu-Desktop/pull/35) | Seven nits: rejected invokes caught (PairDialog, DeviceList, DeviceDetail), RejoinBanner re-arms on tick, hub `Unavailable` once per generation, build.rs finds `$PROFILE` by name, PairDialog draft lives in App and unmount cancels a pending connect, tray left click restores only, Quit retry. No review round. |
| DT-09 | [#33](https://github.com/SumukhaK/Setu-Desktop/pull/33) | Tray (Show/Quit), close hides, restore resyncs, Quit confirm in UI then `end_all_sessions` + `Supervisor::stop()`. No review round; builder caught the prompt's `-32012` error (`-32012` = NotPaired, `-32020` = NoSession). |
| UK-03 | [#31](https://github.com/SumukhaK/Setu-Desktop/pull/31) | Solo end-state notices (peer_closed + reason, expired, abnormal), Dismiss kept in App, manual Reconnect via `DevicesPort.connect`, notice hides once the device is live again. No review round. |
| UK-02 | [#29](https://github.com/SumukhaK/Setu-Desktop/pull/29) | App shell: chrome, rail, Workspace and Devices pages, one stylesheet from the prototype tokens, dev-only CSP. No review round; reviewer checked the build under the production CSP header. |
| UK-01 | [#26](https://github.com/SumukhaK/Setu-Desktop/pull/26) | CI on Linux + Windows MSVC and a real-daemon e2e job. The e2e failed until the reviewer's fix (#27) kept one ADB stream open across the relay outage. |
| DT-08 | [#24](https://github.com/SumukhaK/Setu-Desktop/pull/24) | Saved devices list, nicknames (AD-14), connect by id, forget with inline confirm, SlotGuard token fix. No review round; gates re-run on Linux and a live run against daemon v1.1.0 passed. |
| DT-07 | [#21](https://github.com/SumukhaK/Setu-Desktop/pull/21) | Rejoin banners: pure `rejoinMachine`, one-timer `RejoinBanner`, `at` stamps on tunnels, one Clock shared by store and cards. No review round; gates re-run on Linux. |
| DT-06 | [#19](https://github.com/SumukhaK/Setu-Desktop/pull/19) | Session card, three-fact status strip (Listener, Local ADB, Transport), Disconnect via `session.stop`, audit transport fallback. No review round; gates re-run on Linux. |
| DT-05 | [#17](https://github.com/SumukhaK/Setu-Desktop/pull/17) | ADB watcher (track-devices-l, reconnect), loopback-only snapshot, `adb connect` with timeout, per-session ADB line. No review round; gates re-run on Linux. |
| DT-04 | [#15](https://github.com/SumukhaK/Setu-Desktop/pull/15) | Pairing dialog (NNNN-NNNNNN, inline errors, no timer), `call_cancellable`, pairing commands with a single pending slot. No review round; gates re-run on Linux. |
| DT-03b | [#13](https://github.com/SumukhaK/Setu-Desktop/pull/13) | Event hub (dedicated connection, resync gate, typed allowlist) and pure session store + `useSessions`. No review round; gates re-run on Linux; `session.list` shape checked against daemon v1.1.0 (empty list is `[]`, not null). |
| DT-03a | [#11](https://github.com/SumukhaK/Setu-Desktop/pull/11) | Tauri v2 shell, single instance, Solo supervisor start, live daemon status strip, UI toolchain and gates. No review round; gates re-run on Linux by the reviewer. |

## Open items

- Active ticket: DT-10 · Android 11+ debugger pairing (prompt issued 2026-11-25). `log/redact.rs` (pure, hand-scanned: NNNN-NNNNNN, exact 6-digit runs, pairing_code/token JSON values), `commands/pair_adb.rs` (shares PendingConnect; never sends `adb_path`, daemon decodes params strictly), PairAdbDialog on the session card, behind `VITE_SETU_ADB_PAIR=1`. Then DT-11.
- 2026-11-22 audit (TDD_TICKETS §5a): UK-01..UK-04 all done (#26, #29, #31, #35). v1.1.0 has no shutdown RPC: an attached daemon survives Quit with no sessions (SDK ask §7 item 5). The merged Rust core passed a live run against daemon v1.1.0; `session.stop` emits `path_down` just before `session_down`.
- Design rebase merged (#8): the phone's session label is now shown as **Connected as (unverified)** (peerLabel may be the desktop label, corporate user or key fingerprint). The T−5 minute warning hook (`setuDesktopSessionDeadline`) has no v1.1.0 source: native tickets must never feed it a credential `expires_at`. The page allowlist excludes `auth.set_token` and `identity.public_key` (native only, DT-14).
- Merged `feature/*` and `upkeep/*` branches aren't auto-deleted; turn on "Automatically delete head branches".
- SDK v1.1.1 asks and backend items: TDD_TICKETS.md §7. DT-10 stays behind a flag until the device-lab gate there passes. v1.1.0 prints only `daemon_ready` on stdout; if a future daemon writes more, recheck the drain thread on SDK upgrades.
