# Setu-Desktop · codebase memory

Read this first. It replaces a repo scan. Keep it under 150 lines; update it in every post-merge ritual.

Last updated: 2026-11-21 · main @ `0159627` (DT-03a merged, DT-03b prompt issued) · SDK baseline: Setu-SDK v1.1.0 (`SumukhaK/Setu` tag `v1.1.0`, commit `921aded`)

## Pipeline

- Architect/reviewer: Claude. Builders: one ticket per PR from `docs/TDD_TICKETS.md`, branch from latest `main`.
- Active builder prompt: `docs/prompts/CURRENT_TASK.md`. Review fixes: `docs/REVIEW_FIX_PROMPT.md` (exists only while a PR needs changes).
- Acceptance tests: `docs/JOURNEYS.md` P01–P22 (canonical for both repos). Screens: `docs/SCREENS.md` D01–D10.
- SDK contract: https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md (§2 daemon JSON-RPC, §2.3 error table, §1.5 events). Daemon source: `core/internal/daemon/cmd.go` (flags, ready line, token file).
- The reviewer runs the Rust gates in Claude's cloud session; there is no CI yet.

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
  index.html main.tsx App.tsx          App(port) = heading + StatusStrip
  daemon/status.ts                     DaemonStatus, DaemonPort, statusLabel(), useDaemonStatus(port)
  daemon/StatusStrip.tsx               role="status", "Checking…" until first status
  platform/tauri.ts                    tauriDaemonPort: the only @tauri-apps/api import
  test/setup.ts                        jest-dom + cleanup
src-tauri/                             lib `setu_desktop` + bin `setu-desktop` (default-run) + bin `fake-setu-daemon`
  Cargo.toml Cargo.lock build.rs       build.rs: tauri_build + Windows test manifest / WebView2Loader.dll copy (GNU)
  tauri.conf.json capabilities/ icons/ one "main" window "Setu", strict CSP, bundle inactive, no externalBin
  src/main.rs                          setu_desktop::app::run()
  src/lib.rs                           pub mod app; pub mod daemon; pub mod rpc;
  src/app/mod.rs                       #[cfg(not(test))] mod shell: builder, single-instance, setup, status forwarder, daemon_status
  src/app/status.rs                    AppStatus, status_of, resolve_daemon_path, resolve_relay (+ unit tests)
  src/rpc/mod.rs                       re-exports
  src/rpc/framing.rs                   encode(), LineDecoder, MAX_LINE_BYTES (1 MiB, excl. newline)
  src/rpc/client.rs                    RpcClient, Notification, VersionInfo (~265 lines)
  src/rpc/errors.rs                    SetuError, from_error_object()
  tests/framing.rs                     9 framing tests
  tests/error_mapping.rs               P11 table test (all rows + unknown codes)
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
- `RpcClient::auth(&self, token: &str) -> Result<(), SetuError>` (expects `{ok:true}`); `RpcClient::version() -> Result<VersionInfo { version, mode, audit }, SetuError>`.
- `rpc::Notification { method: String, params: Value }` (no `Debug`, on purpose: AD-5).
- `rpc::SetuError`: `Protocol{code,message}`, `Unauthorized`, `Denied{code,kind,message}` (−32010 and every unknown code; `kind` is `""` when absent), `Unavailable`, `NotPaired`, `BadCode`, `Revoked`, `TokenInvalid`, `TokenExpired`, `NoGrant`, `Blocked`, `NoSession`, `AuditDisabled`, `Cancelled`, `AdbPairFailed`, `Unsupported`, `SessionExpired`, `PeerClosed`, `Busy`, plus client-side `FrameTooLarge`, `Disconnected`, `Io` (connect only), `UnexpectedResult`. `code() -> Option<i64>`.
- `rpc::from_error_object(&Value) -> SetuError` (missing code → `Protocol{-32603}`); `rpc::encode`, `rpc::LineDecoder::feed(&[u8]) -> Result<Vec<Vec<u8>>, SetuError>`.
- `daemon::Supervisor::start(workspace, app_data, DaemonConfig, SupervisorOptions) -> Supervisor` (Clone; returns at once). `subscribe() -> watch::Receiver<DaemonState>`; `async stop()`. `DaemonState = Starting | Ready{client: RpcClient, generation (from 1), pid, attached} | Restarting{attempt, retry_in} | Failed{reason} | Stopped` (no Debug). Dropping a Supervisor or its runtime never kills the daemon (P17). The child is a `std::process::Child`; stdout is drained on a dedicated OS thread.
- `daemon::Workspace::corporate(slug)` validates `[a-z0-9-]{1,63}`, no leading `-`. `read_attach_record` / `write_attach_record` (atomic) / `remove_attach_record`. Attach only to loopback records.
- `app::status::AppStatus` (serde tag `state`, snake_case): `NotConfigured | Starting | Ready{version: Option<String>, attached, generation} | Restarting{attempt, retry_in_ms} | Failed{reason} | Stopped`. Native → UI: `invoke("daemon_status")` + event `"daemon-status"`.
- `app::run()` (not in unit-test builds): starts the Solo supervisor when `SETU_RELAY_URL` resolves, label from `COMPUTERNAME`/`HOSTNAME`, keeps the `Supervisor` in managed state, never stops it on close.
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

## Architecture decisions (binding on builders)

- AD-1: `src-tauri` keeps the lib target `setu_desktop`; the Tauri app binary is `setu-desktop` (DT-03a). Tauri code lives only in `app/` (the `shell` module is `#[cfg(not(test))]`, so lib unit tests stay GUI-free); `daemon/` and `rpc/` never import tauri.
- AD-2: RPC errors map by numeric `code`; `data.kind` is kept for display/logs. Unknown server codes become `SetuError::Denied`. Never guess a specific error.
- AD-3: Any framing or protocol violation (line over 1 MiB, invalid JSON, EOF, write failure) closes the connection and fails every pending call with `Disconnected`. Dropping the last `RpcClient` also closes it. The DT-02 supervisor owns reconnecting.
- AD-4: `-32027 busy` is retried once inside the client after 100 ms. A second busy is returned.
- AD-5: Never log or persist secrets (`auth.token`, `pairing_code`, JWTs, proxy credentials). Types that can hold them don't derive `Debug`, or redact it. DT-10 adds the redaction layer.
- AD-6 (DT-02): The supervisor takes the daemon executable path as input. Bundling `setu-daemon` as a Tauri sidecar (`tauri.conf.json` `externalBin`) moves to DT-17 (AD-8).
- AD-8 (DT-03a): No sidecar yet. Tauri v2 `externalBin` fails the build when `binaries/setu-daemon-<triple>` is missing, so the app resolves the daemon at runtime: `SETU_DAEMON_PATH` if set, else `setu-daemon[.exe]` next to the app executable. DT-17 adds the checksummed fetch and the sidecar. The Solo relay URL comes from `SETU_RELAY_URL` (runtime env, then compile-time `option_env!`) until DT-12; without one the app shows "No relay configured" and starts no supervisor.
- AD-9 (DT-03a): UI ports. React code never imports `@tauri-apps/api` outside `src/platform/tauri.ts`; features take a typed port (`DaemonPort`) so Vitest uses a fake. Native → UI state is pushed as Tauri events plus one initial `invoke` read; payloads are plain serde structs that can't hold secrets.
- AD-7 (DT-02): `setu-daemon` v1.1.0 has no single-instance guard per state dir. The app records the live daemon in `<state>/desktop-daemon.json` (`listen`, `pid`, `version`; no secrets). On start it attaches when that address authenticates with `<state>/daemon.token`, else it spawns.

## Completed tickets

| Ticket | PR | Summary |
| --- | --- | --- |
| DT-01 | [#3](https://github.com/SumukhaK/Setu-Desktop/pull/3) | JSON-RPC client core, full error table, framing, busy retry, FakeDaemon. One review round (connection leak on drop, fixed). |
| DT-02 | [#6](https://github.com/SumukhaK/Setu-Desktop/pull/6) | Daemon supervisor, workspaces, attach record, ready line, fake daemon bin. One review round (`kill_on_drop` broke P17; token could go to a non-loopback record). |
| DT-03a | [#11](https://github.com/SumukhaK/Setu-Desktop/pull/11) | Tauri v2 shell, single instance, Solo supervisor start, live daemon status strip, UI toolchain and gates. No review round; gates re-run on Linux by the reviewer. |

## Open items

- Active ticket: DT-03b · Event hub and session store (prompt issued 2026-11-21). It adds AD-10 (dedicated events connection; `DaemonState::Ready.listen`, `daemon::connect_authenticated`) and AD-11 (typed event allowlist across the bridge); record both here after merge.
- `build.rs` locates `WebView2Loader.dll` as `OUT_DIR` 4 levels up, which matches Cargo's new build-dir layout only; an older Cargo on Windows GNU fails the build. Switching the dev machine to the MSVC toolchain would remove the workaround.
- The CSP `style-src 'self'` blocks Vite's dev-time `<style>` injection. The first ticket that adds CSS (likely DT-06) must use linked stylesheets or adjust dev CSP deliberately.
- If `version` fails once for a generation it is not retried, so the strip shows "Setu service ready" without a version. Acceptable; revisit if it shows up in practice.
- Design rebase merged (#8): the phone's session label is now shown as **Connected as (unverified)** (peerLabel may be the desktop label, corporate user or key fingerprint). The T−5 minute warning hook (`setuDesktopSessionDeadline`) has no v1.1.0 source: native tickets must never feed it a credential `expires_at`. The page allowlist excludes `auth.set_token` and `identity.public_key` (native only, DT-14).
- If a future daemon writes to stdout after `daemon_ready`, the drain thread ends when the app exits and later writes may hit a closed pipe. v1.1.0 prints only the ready line; recheck on SDK upgrades.
- Supervisor stop uses blocking `kill()`/`wait()` on the async task; fine because both return promptly after kill.
- No CI yet. Consider a GitHub Actions workflow as an `upkeep/` ticket after DT-03.
- Merged branches `feature/DT-01-jsonrpc-client` and `feature/DT-02-daemon-supervisor` couldn't be deleted from Claude's session. Turn on "Automatically delete head branches".
- SDK v1.1.1 asks and backend items: TDD_TICKETS.md §7.
- DT-10 stays behind a flag until the device-lab gate in §7 passes.
