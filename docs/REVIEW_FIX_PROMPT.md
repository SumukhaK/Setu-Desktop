# Review fix prompt · DT-02 · round 1 (PR #6)

You are the builder for `SumukhaK/Setu-Desktop`. Fix only what is below, on the existing branch `feature/DT-02-daemon-supervisor` (PR #6). Push to the same PR. Do not open a new PR, do not merge, then stop.

## Verdict

Most of PR #6 passes review. The workspace, config argv, ready line, backoff, attach, stale record, crash and restart, Failed after 5 attempts, and `stop()` all match the prompt, and the Assumptions block is thorough. The reviewer re-ran all three gates on Linux (fmt OK, clippy clean, 43 tests green). Two findings must be fixed. The first breaks P17.

## Finding 1 (blocking, P17): `kill_on_drop(true)` kills the daemon when the app exits

File: `src-tauri/src/daemon/supervisor.rs`, `spawn_once` (`command.kill_on_drop(true)`).

P17 says the daemon outlives the window and the next start attaches. In production the next start is a new app process. When the app exits, its tokio runtime shuts down. That drops the run task, then the `Child`, and `kill_on_drop` kills the daemon. Your survive-drop test passes only because the runtime stays alive inside `#[tokio::test]`.

The reviewer reproduced it with a plain `#[test]`:
1. Build a `current_thread` runtime.
2. Start a supervisor and reach Ready.
3. Drop the handle, then drop the runtime.
4. Try to connect to the recorded `listen`.

With `kill_on_drop(true)`, the connection is refused (the daemon is dead). With `kill_on_drop(false)`, the daemon is alive.

Required:
- Remove `kill_on_drop(true)`. Don't set it at all; tokio's default is false.
- Every failure path in `spawn_once` that returns after spawning must kill and wait for the child explicitly via `kill_child`. The one path that currently relies on drop is the `write_attach_record` error. Re-check that no other `?` after `spawn()` can leak a live child.
- Add the integration test `p17_daemon_survives_runtime_shutdown`. It is a plain `#[test]` (not `#[tokio::test]`) that holds `lock_fake_env()` and runs these steps:
  1. Build its own `tokio::runtime::Builder::new_current_thread().enable_all()` runtime.
  2. Inside it, start a supervisor, wait for Ready and drop the handle.
  3. Drop the runtime.
  4. With a std `TcpStream::connect_timeout` (1 s) to the attach record's `listen`, assert the daemon is still reachable.
  5. In a second fresh runtime, start a new supervisor and assert `Ready { attached: true }` with the same pid.
  6. Clean up by killing the pid with your existing platform split (`taskkill /PID <pid> /F` on Windows, `kill <pid>` elsewhere, via `std::process::Command`).

## Finding 2 (required, token safety): attach sends the token to whatever address the record names

File: `src-tauri/src/daemon/supervisor.rs`, `start_once`.

`ready_line::parse` rejects a non-loopback `listen`, but the attach path trusts `record.listen` as written. A corrupted or edited `desktop-daemon.json` would make the supervisor connect to a LAN or remote host and send `auth` with the daemon token.

Required:
- Before connecting, treat a record whose `listen.ip()` is not loopback as stale. Don't connect, and fall through to spawn.
- Add an integration test: write a record with `listen: "10.255.255.1:9"` and a `daemon.token` in the state dir. The supervisor must reach `Ready { attached: false }` (a fresh spawn) within the normal test timeout. Because of the check it never tries to connect, so it must not wait out `ready_timeout`. To prove the fast path, set `ready_timeout` to 3 s and assert Ready arrives in under 2 s.

## TDD (red first)

- Commit 1: `test(desktop): DT-02 daemon survives runtime shutdown; non-loopback record is stale (red)`. Paste the red excerpt; both tests should fail on the current code.
- Commit 2: `fix(desktop): DT-02 no kill_on_drop, loopback-only attach`.

## Rules

- Touch only `src-tauri/src/daemon/supervisor.rs` and `src-tauri/tests/daemon_supervisor.rs`. No other refactors. Don't change `src/rpc/`.
- Nits (don't act on them): the over-length files are accepted for this ticket, as justified in your Assumptions.

## Gates

From `src-tauri/`:

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Paste the red excerpt and the full green output of all three gates in one PR comment titled `Review fix round 1`, naming the OS. Then **stop**.
