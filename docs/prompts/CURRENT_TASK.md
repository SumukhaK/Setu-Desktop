# Builder prompt · DT-02 · Daemon supervisor and workspaces

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-7; AD-6 and AD-7 are new for this ticket).
2. `docs/TDD_TICKETS.md` §5 "DT-02".
3. `docs/JOURNEYS.md` rows P17 and P18.
4. Setu-SDK v1.1.0 `API_SPEC.md` §2 (transport, ready line, startup flags): https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
5. The daemon's own flag parsing, ready line and token file, as ground truth: `core/internal/daemon/cmd.go` at tag `v1.1.0`.
6. Existing code you will use, not change: `src-tauri/src/rpc/` (`RpcClient`, `SetuError`).

## 1. Goal

A Rust supervisor that runs one `setu-daemon` per workspace. It spawns the daemon with the right flags, reads the single `daemon_ready` line, reads the token file and authenticates. It attaches to an already-running daemon for the same workspace instead of starting a second one, restarts the daemon with backoff when it exits, and publishes its state so later tickets can re-list sessions. There is no Tauri, no UI, no sidecar bundling (AD-6) and no events subscription (DT-03).

## 2. Files (create or change only these)

```
src-tauri/Cargo.toml                         add tokio "process" feature; [[bin]] for the test daemon (below); dev-dep tempfile
src-tauri/src/lib.rs                         add `pub mod daemon;`
src-tauri/src/daemon/mod.rs                  re-exports
src-tauri/src/daemon/workspace.rs            Workspace (solo | corporate slug), state dir paths, attach record read/write
src-tauri/src/daemon/config.rs               DaemonConfig + to_args() (start flags)
src-tauri/src/daemon/ready_line.rs           parse/validate the daemon_ready line
src-tauri/src/daemon/supervisor.rs           spawn / attach / auth / restart-with-backoff / stop; state watch
src-tauri/tests/support/fake_setu_daemon.rs  test-only executable that behaves like setu-daemon (see §3)
src-tauri/tests/daemon_supervisor.rs         integration tests
```

Unit tests for the pure parts (`workspace`, `config`, `ready_line`, backoff) can live in `#[cfg(test)] mod tests` in those files.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Workspace (`workspace.rs`).**
- `enum Workspace { Solo, Corporate { org_slug: String } }`. Use `Workspace::corporate(slug) -> Result<Workspace, SetuError>` to accept only `[a-z0-9-]{1,63}`, not starting with `-`. Anything else (`""`, `"../x"`, `"Acme"`, `"a/b"`) is rejected.
- `fn state_dir(&self, app_data: &Path) -> PathBuf`: `<app_data>/setu/solo` or `<app_data>/setu/corp/<org_slug>`. Create the directory when spawning, not here.
- The attach record (AD-7) is `<state_dir>/desktop-daemon.json` = `{"listen": "127.0.0.1:NNNN", "pid": N, "version": "1.1.0"}`. Write it atomically (temp file in the same dir, then rename) after a successful spawn and auth. Reading a missing or malformed record returns `None`. It never contains the token.

**Config (`config.rs`).**
- `DaemonConfig { daemon_path: PathBuf, relay: String, label: Option<String>, adb_path: Option<PathBuf>, relay_pin: Option<String>, proxy: Option<String>, corporate: Option<CorporateFlags { identity_file: PathBuf, policy_file: PathBuf }> }`.
- `fn to_args(&self, state_dir: &Path) -> Vec<OsString>` returns exactly, in this order: `--listen 127.0.0.1:0 --state <dir> --relay <url>`, then `--label <name>` and `--adb <path>` when set, `--relay-pin <hex>` and `--proxy <url>` when set, and `--mode corporate --identity-file <f> --policy <p>` when corporate. Never add `--stdio` and never add `--mode solo` (it's the default).
- `DaemonConfig` must not derive `Debug` (the proxy URL can carry credentials, AD-5).

**Ready line (`ready_line.rs`).**
- `struct ReadyLine { listen: SocketAddr, version: String, token_file: PathBuf, pid: u32 }` and `fn parse(line: &str) -> Result<ReadyLine, SetuError>`.
- Reject with `SetuError::UnexpectedResult`: invalid JSON, `event != "daemon_ready"`, a non-loopback `listen`, or a version below 1.1.0 (compare the numeric major.minor.patch triple; a prerelease suffix after `-` is ignored).

**Supervisor (`supervisor.rs`).**
- `Supervisor::start(workspace: Workspace, app_data: PathBuf, config: DaemonConfig, options: SupervisorOptions) -> Supervisor` returns immediately and does its work on a spawned task. `SupervisorOptions { ready_timeout: Duration (default 10 s), backoff_base: Duration (default 500 ms), backoff_max: Duration (default 30 s) }` implements `Default`. Tests pass small values.
- `fn subscribe(&self) -> tokio::sync::watch::Receiver<DaemonState>` where `enum DaemonState { Starting, Ready { client: RpcClient, generation: u64, pid: u32, attached: bool }, Restarting { attempt: u32, retry_in: Duration }, Failed { reason: String }, Stopped }`. `generation` starts at 1 and increases by 1 on every new Ready. DT-03 re-lists sessions when it changes (P18).
- **Startup:** read the attach record. If there is one, connect to its `listen`, read `<state_dir>/daemon.token` (trim whitespace) and `auth`. If both succeed, publish `Ready { attached: true }` and don't spawn. Otherwise spawn: create the state dir, run `daemon_path` with `to_args`, stdin null, stderr null (never read or log it), stdout piped. Read the **first** stdout line within `ready_timeout`, `parse` it, then keep draining stdout in the background and discard it. Read `token_file` from the ready line, connect to `listen`, `auth`, write the attach record and publish `Ready { attached: false }`.
- **Crash / exit (spawned daemon):** when the child exits unexpectedly, publish `Restarting { attempt, retry_in }`, wait `retry_in`, then spawn again. Delay is `min(backoff_base * 2^(attempt-1), backoff_max)`, as a pure `fn restart_delay(attempt, base, max)`. `attempt` resets to 0 after a Ready. A ready-line timeout or parse failure kills that child and counts as a failed attempt. After 5 consecutive failed attempts, publish `Failed { reason }` and stop retrying. The reason names the step, for example "daemon did not print daemon_ready within 10s", and never contains a token or the proxy URL.
- **Attached daemon goes away:** when the attached connection's notification channel ends (EOF), treat it like a crash of a daemon we don't own: go through the same Restarting path, which re-reads the attach record and then spawns.
- `async fn stop(&self)`: if this supervisor spawned the daemon, kill the child and wait for it. If it only attached, just drop the client. Remove the attach record only if this supervisor spawned that pid. Publish `Stopped`. Dropping a `Supervisor` without `stop()` must **not** kill the daemon. P17: the daemon outlives the window, and the next start attaches.
- Read the token only in Rust. Never put it in `DaemonState`, errors, `Debug` output or the attach record.

**Test daemon (`tests/support/fake_setu_daemon.rs`, a `[[bin]]` named `fake-setu-daemon` with `test = false`, `doc = false`).** It's a small, real executable (keep it under ~150 lines) that integration tests reach through `env!("CARGO_BIN_EXE_fake-setu-daemon")`.
- It accepts the real flags (ignoring unknown ones) and binds `--listen`. It writes a random token to `<state>/daemon.token` unless one exists, and prints exactly one `daemon_ready` line with its real pid.
- It serves newline JSON-RPC: `auth` (must come first, else `-32001`), `version` → `{"version":"1.1.0","mode":"solo","audit":false}`, `session.list` → `{"sessions":[]}`.
- Env knobs for tests only: `FAKE_DAEMON_EXIT_AFTER_MS` (exit with code 1 after N ms), `FAKE_DAEMON_NO_READY=1` (bind but never print the ready line), and `FAKE_DAEMON_ARGS_FILE=<path>` (write its argv as JSON lines to that file so tests can assert the flags).
- Use only crates already in `[dependencies]` (tokio, serde_json). It may reuse `setu_desktop::rpc::{LineDecoder, encode}`.

## 4. TDD: write these tests first, see them fail, then implement

Map each test to its acceptance ID in a comment. Wrap every await in a timeout (5 s), and use `tempfile` dirs. Don't use bare sleeps to wait for state: await the `watch` receiver with `wait_for`.

- **Workspace:** solo and corporate paths; the invalid slugs above are rejected; the attach record round-trips, a malformed record reads as `None`, and the written file contains no `token`.
- **Config:** exact argv for solo-minimal, solo-with-label-adb-pin-proxy and corporate. There is no `--stdio` and no `--mode solo`.
- **Ready line:** a valid line parses. Wrong event, `listen: "0.0.0.0:1"`, malformed JSON and `version: "1.0.4"` are rejected; `"1.1.0-rc1"` and `"1.2.0"` are accepted.
- **Backoff:** `restart_delay` gives 500 ms, 1 s, 2 s, … and caps at max.
- **P18 spawn:** the supervisor spawns the fake, reaches `Ready { generation: 1, attached: false }`, and `client.version()` works. The attach record exists with the fake's pid. The fake's argv file shows `--listen 127.0.0.1:0` and the workspace `--state` dir.
- **P18 attach:** with supervisor A Ready, supervisor B for the same workspace and app_data reaches `Ready { attached: true }` with the **same pid**, and no second process was started (the args file has one line).
- **P18 stale record:** an attach record pointing at a closed port leads to a fresh spawn and `attached: false`.
- **P18 crash and restart:** with `FAKE_DAEMON_EXIT_AFTER_MS=300` on the first run only (for example, through a marker file the fake checks), the state goes Ready gen 1 → Restarting attempt 1 → Ready gen 2 with a **different pid**.
- **Ready timeout:** with `FAKE_DAEMON_NO_READY=1`, `ready_timeout = 300 ms` and `backoff_base = 10 ms`, it ends in `Failed` after 5 attempts. The reason mentions `daemon_ready` and no fake process is left running (each child was killed).
- **P17 stop and drop:** `stop()` on the spawning supervisor kills the child (its port refuses connections afterwards), removes the attach record and publishes `Stopped`. Separately, dropping a Ready supervisor without `stop()` leaves the daemon reachable. A new supervisor then attaches (clean it up at the end with `stop()` from a supervisor that owns it, or kill the pid).

## 5. Gates (all must pass before you push)

From `src-tauri/`:

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Tests must pass on the platform you build on. Note which OS you ran on in the PR. Avoid Unix-only APIs (signals, `/proc`); use `tokio::process::Child::kill` and connection checks.

## 6. Karpathy pillars (enforced at review)

1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. If the ticket, this prompt, `API_SPEC.md` and `cmd.go` disagree, stop and ask.
2. **Simplicity first.** Write the minimum code: no Tauri, no events subscription, no session re-list (DT-03 does it from `generation`), no config file loading, no logging crate, no traits for "process launcher" abstractions. The test daemon is a real executable precisely so production code needs no seams. Keep files under ~250–300 lines.
3. **Surgical changes.** Don't change `src/rpc/` or its tests. Touch only the files in §2. Branch from latest `main` as `feature/DT-02-daemon-supervisor`. Make atomic conventional commits (`test(desktop): …` red first, then `feat(desktop): …`).
4. **Goal-driven TDD.** Commit the failing tests first, then the implementation. Paste the red excerpt and the full green output of all three gates in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-02 daemon supervisor and workspaces`, with this body:

```
Ticket: DT-02 (docs/TDD_TICKETS.md §5) · Acceptance: P18, P17 (stop / survive drop)

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<full green output of cargo fmt --check, cargo clippy --all-targets -- -D warnings, cargo test>

## Out of scope (left for later tickets)
- Tauri shell + sidecar bundling + single-instance (DT-03), events hub and session re-list (DT-03), settings UI and restart-on-change (DT-12), tray/quit (DT-09)
```

Then **stop immediately**. Don't start DT-03, don't edit `docs/`, and don't merge.
