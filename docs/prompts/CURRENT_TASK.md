# Builder prompt · UK-01 · CI and real-daemon smoke test

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-14).
2. `docs/TDD_TICKETS.md` §5a "UK-01".
3. Existing code you'll drive, as public API, without changing it:
   - `src-tauri/src/daemon/` (`Supervisor`, `DaemonConfig`, `DaemonState`, `Workspace`)
   - `src-tauri/src/events/` (`events::start`, `HubMessage`, `HubEvent`)
   - `src-tauri/src/commands/` (`connect_with_code`, `connect_with_device`, `stop_session`, `list_devices`, `forget_device`, `PendingConnect`)
   - `src-tauri/src/store/nicknames.rs`
4. Setu-SDK v1.1.0, `core/cmd/setu` (`setu relay`, `setu device`) and `core/cmd/setu-daemon`: https://github.com/SumukhaK/Setu/tree/v1.1.0/core/cmd

**Facts this ticket relies on (verified by the reviewer against binaries built from tag `v1.1.0` on 2026-11-22):**
- `go build -o <dir> ./cmd/setu ./cmd/setu-daemon`, run from `core/` with Go 1.24, builds both binaries.
- `setu relay --listen 127.0.0.1:<port> --state <dir>` is a Solo relay.
- `setu device --relay 127.0.0.1:<port> --adbd 127.0.0.1:<echo port> --name phone --state <dir>` is the phone agent. It prints JSON lines on stdout, including `{"event":"pairing_code","code":"NNNN-NNNNNN","device_id":"dev-…"}`. The agent frames ADB packets, so raw bytes don't round-trip. Send one 24-byte ADB header: six little-endian u32 values `CNXN 0x4e584e43`, `0x01000000`, `4096`, `0`, `0`, and `0x4e584e43 ^ 0xffffffff`. The echo server returns the same 24 bytes.
- Killing the relay for 4 s and restarting it on the same port makes the hub forward `path_down` then `path_up` (`relay-tcp`, `outage_ms` ≈ 5100) for one tunnel id, and bytes still round-trip afterwards.
- `session.stop` emits a `path_down` just before `session_down`. Don't assert that no `path_down` follows the outage.
- `devices.forget` → `{}`. A second forget → `-32012`. `connect_with_device` after a forget → `NotPaired`.

## 1. Goal

Every PR gets the full gate set on Linux and Windows, plus one real-SDK end-to-end run on Linux. Today the reviewer re-runs the gates by hand and nothing runs against a real daemon. This ticket changes no app behaviour.

## 2. Files (create or change only these)

```
.github/workflows/ci.yml                  three jobs (§3)
src-tauri/tests/e2e_real_daemon.rs        the smoke test (§3)
README.md                                 + a short "Real-daemon smoke test" section: how to build the SDK binaries and run the test locally
```

Don't change anything under `src/` or `src-tauri/src/`, `Cargo.toml` or `package.json`. Add no crate and no npm package (`tokio`, `serde_json` and `tempfile` are already available to tests). If `Cargo.toml` truly must change, stop and say why.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Workflow (`.github/workflows/ci.yml`).** It runs `on: pull_request` and `push` to `main`, with `permissions: contents: read` and a `concurrency` group per ref that cancels in-progress runs.

1. `gates-linux` (`ubuntu-latest`):
   - `apt-get install` `libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
   - `actions/setup-node` with Node 22 and an npm cache
   - `dtolnay/rust-toolchain@stable` with `rustfmt, clippy`, then `Swatinem/rust-cache` with `workspaces: src-tauri`
   - then, in order: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, and in `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
2. `gates-windows` (`windows-latest`, the MSVC toolchain): the same steps without `apt-get`.
3. `e2e-linux` (`ubuntu-latest`, `needs: gates-linux`):
   - the same apt, Node and Rust setup
   - `actions/checkout` a second time with `repository: SumukhaK/Setu`, `ref: v1.1.0`, `path: setu-sdk`
   - `actions/setup-go` with `go-version-file: setu-sdk/core/go.mod`
   - `cd setu-sdk/core && go build -o "$RUNNER_TEMP/setu-bin" ./cmd/setu ./cmd/setu-daemon`
   - `SETU_E2E_BIN_DIR=$RUNNER_TEMP/setu-bin cargo test --test e2e_real_daemon -- --nocapture` from `src-tauri`

   If the SDK checkout fails for permissions, pass `token: ${{ secrets.SETU_SDK_TOKEN }}` and say in the PR that the owner must add a read-only fine-grained token with that name. Don't commit any token.

No `continue-on-error`, no skipped steps, and no matrix beyond these three jobs.

**Smoke test (`tests/e2e_real_daemon.rs`).**
- One `#[tokio::test(flavor = "multi_thread")]`. If `SETU_E2E_BIN_DIR` is unset, it prints one line and returns, so it passes. With the variable set, every step is required.
- Helpers, all inside this file:
  - `free_port()`: bind `127.0.0.1:0`, read the port, then drop the listener.
  - A `Child` guard that kills its process on `Drop`.
  - An in-test echo server on a free port, run in a std thread.
  - Every wait is wrapped in `tokio::time::timeout`, and the whole test finishes in under 60 s. A failure must never hang CI.
- Steps:
  1. Start the relay, then the device agent with `--adbd` set to the echo port. Read stdout lines until `pairing_code` (10 s timeout).
  2. Start `Supervisor::start(Workspace::Solo, <tempdir>, DaemonConfig { daemon_path: <bin>/setu-daemon, relay: "127.0.0.1:<port>", label: Some("e2e"), adb_path: None, relay_pin: None, proxy: None, corporate: None })`. Wait for `DaemonState::Ready`, then call `events::start(sup.subscribe(), Workspace::Solo.state_dir(&app_data))`.
  3. Assert the first hub message is a `Snapshot` with no sessions.
  4. Run `connect_with_code` with the agent's code and assert `Connected`. The hub forwards `Listening` and `SessionUp` for that session id.
  5. Open TCP to `adb_addr`, send the 24-byte header and read exactly 24 bytes back.
  6. Kill the relay, wait 4 s, and restart it on the same port. Within 20 s, assert the hub forwarded `PathDown` then `PathUp` with the same `tunnel_id`. The header must round-trip again.
  7. Run `stop_session`, assert `Stopped`, and assert `SessionDown { abnormal: false }` for that session within 5 s.
  8. Run `set_nickname(store, device_id, "  E2E ")` → `Saved{Some("E2E")}`, then `list_devices` → one row with that nickname.
  9. Run `connect_with_device(device_id)` → `Connected`, then `stop_session` → `Stopped`.
  10. Run `forget_device` → `Forgotten`, and a second `forget_device` → `NotPaired`. `list_devices` returns `Listed{[]}`, and `connect_with_device` returns `NotPaired`.
  11. Call `sup.stop().await`. The guards kill the agent and the relay.
- Match on the typed enums (`HubMessage`, `HubEvent`, the outcome enums), not on JSON strings.

## 4. TDD

This ticket adds tests rather than behaviour, so "red first" means this:
- Commit the workflow and the test first (`test(desktop): …`).
- Show `cargo test --test e2e_real_daemon` passing **without** `SETU_E2E_BIN_DIR`, which skips with one line.
- Show it passing **with** locally built v1.1.0 binaries, on Linux or WSL if you can. If you can't build them locally, say so; the CI run on the PR is then the evidence.
- Paste the green CI run link for all three jobs in the PR.

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

All three CI jobs must be green on the PR's head commit. Use no `#[allow(...)]`, no `#[ignore]`, no `unwrap()` outside tests, and no lint downgrades. In this test file, `expect("what failed")` is preferred over bare `unwrap()`. If a CI job fails for an environment reason you can't fix in the workflow, stop and report the exact log lines.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** The smoke test drives only the Rust core's public API, the same functions the Tauri commands call. It never imports `tauri` (AD-1).
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. If the real daemon differs from §0, follow the daemon, assert what it does, and record it.
2. **Simplicity first.** One workflow file and one test file. No composite actions, no reusable workflows, no scripts directory and no Docker.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `upkeep/UK-01-ci-e2e`, with conventional commits (`test(desktop): …` or `ci: …`).
4. **Goal-driven.** Done means three green CI jobs on the PR, plus the local skip run.

## 7. PR and hard stop

Open one PR against `main` titled `ci: UK-01 CI gates and real-daemon smoke test`, with this body:

```
Ticket: UK-01 (docs/TDD_TICKETS.md §5a)

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<local cargo test --test e2e_real_daemon output: skip line, and the real run if available>
<links to the green gates-linux, gates-windows and e2e-linux runs>

## Out of scope
- packaging (DT-17), corporate mode, the app shell (UK-02)
```

Then **stop immediately**. Don't start UK-02, don't edit `docs/`, and don't merge.
