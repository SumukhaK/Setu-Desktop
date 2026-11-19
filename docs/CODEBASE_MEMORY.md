# Setu-Desktop · codebase memory

Read this first. It replaces a repo scan. Keep it under 150 lines; update it in every post-merge ritual.

Last updated: 2026-11-19 · main @ `ae50eac` (DT-01 merged, DT-02 prompt issued) · SDK baseline: Setu-SDK v1.1.0 (`SumukhaK/Setu` tag `v1.1.0`, commit `921aded`)

## Pipeline

- Architect/reviewer: Claude. Builders: one ticket per PR from `docs/TDD_TICKETS.md`, branch from latest `main`.
- Active builder prompt: `docs/prompts/CURRENT_TASK.md`. Review fixes: `docs/REVIEW_FIX_PROMPT.md` (exists only while a PR needs changes).
- Acceptance tests: `docs/JOURNEYS.md` P01–P22 (canonical for both repos). Screens: `docs/SCREENS.md` D01–D10.
- SDK contract: https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md (§2 daemon JSON-RPC, §2.3 error table, §1.5 events). Daemon source: `core/internal/daemon/cmd.go` (flags, ready line, token file).
- The reviewer runs the Rust gates in Claude's cloud session; there is no CI yet.

## Stack (fixed in TDD_TICKETS.md §4)

- Tauri v2. Rust native core in `src-tauri/`; React + Vite + TypeScript (`strict: true`, no `any`) UI in `src/`.
- Rust gates: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (run from `src-tauri/`).
- UI gates (from the first ticket that adds `src/`): ESLint, Prettier, `tsc --noEmit`, Vitest + Testing Library.
- UI reaches the daemon only through Tauri commands. Tokens, pairing codes and process control stay in Rust.
- Deps today: tokio (rt, net, io-util, sync, macros, time), serde, serde_json, thiserror. No logging crate.

## Directory map

```
README.md  index.html  styles.css      prototype (fixtures, not app code)
src-tauri/                             lib crate `setu_desktop` (no tauri dep yet, AD-1)
  Cargo.toml Cargo.lock
  src/lib.rs                           pub mod rpc;
  src/rpc/mod.rs                       re-exports
  src/rpc/framing.rs                   encode(), LineDecoder, MAX_LINE_BYTES (1 MiB, excl. newline)
  src/rpc/client.rs                    RpcClient, Notification, VersionInfo (~265 lines)
  src/rpc/errors.rs                    SetuError, from_error_object()
  tests/framing.rs                     9 framing tests
  tests/error_mapping.rs               P11 table test (all rows + unknown codes)
  tests/rpc_client.rs                  13 client tests (order, busy, notifications, disconnect, drop)
  tests/support/fake_daemon.rs         FakeDaemon: in-process JSON-RPC line server on 127.0.0.1:0
docs/  JOURNEYS SCREENS TDD_TICKETS CODEBASE_MEMORY prompts/ previews/ walkthrough/
```

## Key public interfaces

- `rpc::RpcClient::connect(addr: SocketAddr) -> Result<(RpcClient, UnboundedReceiver<Notification>), SetuError>`. `RpcClient` is `Clone + Send + Sync`. Dropping the last clone closes the socket and ends the notification channel.
- `RpcClient::call(&self, method: &str, params: Option<Value>) -> Result<Value, SetuError>`: u64 ids from 1, out-of-order safe, one `-32027` retry after 100 ms.
- `RpcClient::auth(&self, token: &str) -> Result<(), SetuError>` (expects `{ok:true}`); `RpcClient::version() -> Result<VersionInfo { version, mode, audit }, SetuError>`.
- `rpc::Notification { method: String, params: Value }` (no `Debug`, on purpose: AD-5).
- `rpc::SetuError`: `Protocol{code,message}`, `Unauthorized`, `Denied{code,kind,message}` (−32010 and every unknown code; `kind` is `""` when absent), `Unavailable`, `NotPaired`, `BadCode`, `Revoked`, `TokenInvalid`, `TokenExpired`, `NoGrant`, `Blocked`, `NoSession`, `AuditDisabled`, `Cancelled`, `AdbPairFailed`, `Unsupported`, `SessionExpired`, `PeerClosed`, `Busy`, plus client-side `FrameTooLarge`, `Disconnected`, `Io` (connect only), `UnexpectedResult`. `code() -> Option<i64>`.
- `rpc::from_error_object(&Value) -> SetuError` (missing code → `Protocol{-32603}`); `rpc::encode`, `rpc::LineDecoder::feed(&[u8]) -> Result<Vec<Vec<u8>>, SetuError>`.
- Test support: `FakeDaemon::start()`, `addr()`, `received()`, `wait_for_requests(n)`, `reply_with`, `reply_with_error`, delayed/reversed replies, `send_raw`, notifications, `close()`. Unscripted methods get `-32601`.

## Wired SDK v1.1.0 bindings

| RPC / event | Wired in | Ticket |
| --- | --- | --- |
| JSON-RPC framing, ids, concurrency, `-32027` retry | `rpc::client` | DT-01 |
| §2.3 error table (−32700..−32603, −32001, −32010..−32027) | `rpc::errors` | DT-01 |
| `auth {token}`, `version` | `RpcClient::auth`, `RpcClient::version` | DT-01 |
| `event`, `events.dropped` notifications (raw) | `Notification` channel | DT-01 |

## Architecture decisions (binding on builders)

- AD-1: `src-tauri` is a plain Rust library crate `setu_desktop` with no `tauri` dependency until the ticket that adds the Tauri app shell (now DT-03, see AD-6).
- AD-2: RPC errors map by numeric `code`; `data.kind` is kept for display/logs. Unknown server codes become `SetuError::Denied`. Never guess a specific error.
- AD-3: Any framing or protocol violation (line over 1 MiB, invalid JSON, EOF, write failure) closes the connection and fails every pending call with `Disconnected`. Dropping the last `RpcClient` also closes it. The DT-02 supervisor owns reconnecting.
- AD-4: `-32027 busy` is retried once inside the client after 100 ms. A second busy is returned.
- AD-5: Never log or persist secrets (`auth.token`, `pairing_code`, JWTs, proxy credentials). Types that can hold them don't derive `Debug`, or redact it. DT-10 adds the redaction layer.
- AD-6 (DT-02): The supervisor takes the daemon executable path as input. Bundling `setu-daemon` as a Tauri sidecar (`tauri.conf.json` `externalBin`) moves to DT-03, together with the Tauri app shell and `src/` scaffold.
- AD-7 (DT-02): `setu-daemon` v1.1.0 has no single-instance guard per state dir. The app records the live daemon in `<state>/desktop-daemon.json` (`listen`, `pid`, `version`; no secrets). On start it attaches when that address authenticates with `<state>/daemon.token`, else it spawns.

## Completed tickets

| Ticket | PR | Summary |
| --- | --- | --- |
| DT-01 | [#3](https://github.com/SumukhaK/Setu-Desktop/pull/3) | JSON-RPC client core, full error table, framing, busy retry, FakeDaemon. One review round (connection leak on drop, fixed). |

## Open items

- Active ticket: DT-02 · Daemon supervisor and workspaces (prompt issued 2026-11-19).
- DT-03 must include: the minimal Tauri v2 app shell, the `setu-daemon` sidecar config (AD-6), and the Vite + React + TS strict + ESLint + Prettier + Vitest scaffold.
- DT-02 adds a test-only `[[bin]] fake-setu-daemon`. When DT-03 adds the Tauri binary, set `default-run` and make sure bundling ships only the app binary.
- Two app instances racing on one workspace: add Tauri's single-instance plugin with the app shell (DT-03).
- No CI yet. Consider a GitHub Actions workflow as an `upkeep/` ticket after DT-03.
- Merged branch `feature/DT-01-jsonrpc-client` couldn't be deleted from Claude's session. Turn on "Automatically delete head branches".
- SDK v1.1.1 asks and backend items: TDD_TICKETS.md §7.
- DT-10 stays behind a flag until the device-lab gate in §7 passes.
