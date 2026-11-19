# Builder prompt · DT-01 · JSON-RPC client core

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (repo map, architecture decisions AD-1 to AD-5).
2. `docs/TDD_TICKETS.md` §4 (stack) and §5 "DT-01".
3. `docs/JOURNEYS.md` row P11.
4. Setu-SDK v1.1.0 `API_SPEC.md` §2 (transport, framing, concurrency), §2.1 (`auth`, `version`), §2.3 (errors): https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md

Do not scan the rest of the repo. `index.html` and `styles.css` are a wireframe prototype: do not touch them.

## 1. Goal

A Rust library that talks JSON-RPC 2.0 to `setu-daemon` v1.1.0 over loopback TCP: newline framing with a 1 MiB cap, concurrent requests matched by unique id, a channel for notifications, typed errors for the whole §2.3 table, and one internal retry on `-32027 busy`. Plus typed `auth` and `version` calls and an in-process fake daemon for tests. No UI, no Tauri, no process spawning.

## 2. Files (create only these, plus `.gitignore` and `Cargo.lock`)

```
src-tauri/Cargo.toml                 plain lib crate `setu_desktop`, edition 2021 (AD-1: no tauri dependency yet)
src-tauri/src/lib.rs                 `pub mod rpc;`
src-tauri/src/rpc/mod.rs             re-exports
src-tauri/src/rpc/framing.rs         pure, sync: encode one message; incremental line decoder with 1 MiB cap
src-tauri/src/rpc/client.rs          RpcClient over tokio TcpStream
src-tauri/src/rpc/errors.rs          SetuError + mapping from a JSON-RPC error object
src-tauri/tests/rpc_client.rs        integration tests
src-tauri/tests/support/mod.rs
src-tauri/tests/support/fake_daemon.rs   scriptable JSON-RPC line server on 127.0.0.1:0
.gitignore                           add `src-tauri/target/` (create the file if absent)
```

Allowed dependencies: `tokio` (features you actually use from rt, net, io-util, sync, macros, time), `serde`, `serde_json`, `thiserror`. Dev: nothing else unless a test truly needs it. No `tokio-util`, no logging crate, no `anyhow` in library code.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Framing (`framing.rs`).** One JSON object per line, UTF-8, `\n`-terminated, max 1 MiB (1,048,576 bytes) per line excluding the newline.
- `encode(&serde_json::Value) -> Result<Vec<u8>, SetuError>`: compact JSON plus `\n`. Over the cap → `SetuError::FrameTooLarge` and nothing is sent.
- A `LineDecoder` you feed byte chunks; it yields complete lines. Handles a line split over many chunks, many lines in one chunk, and skips empty lines. A line growing past the cap → `SetuError::FrameTooLarge`.

**Client (`client.rs`).**
- `RpcClient::connect(addr: SocketAddr) -> Result<(RpcClient, mpsc::UnboundedReceiver<Notification>), SetuError>`. One reader task, writes serialized through one writer.
- `Notification { method: String, params: serde_json::Value }`. Pass `event` and `events.dropped` through raw; DT-03 types them.
- `call(&self, method: &str, params: Option<Value>) -> Result<Value, SetuError>`. Ids are a per-connection `u64` counter starting at 1. Pending calls live in a map keyed by id, so out-of-order responses resolve the right caller. `RpcClient` is `Clone + Send + Sync` and many calls can be in flight at once.
- A response with an unknown id is ignored.
- On `-32027 busy`: wait 100 ms (a `const`), resend once with a new id. A second busy is returned as `SetuError::Busy`.
- AD-3: EOF, invalid JSON, an oversize line or a write failure closes the connection. Every pending and every later `call` returns `SetuError::Disconnected`, and the notification channel closes. No reconnect logic (DT-02 owns that).
- Typed helpers: `auth(&self, token: &str) -> Result<(), SetuError>` (expects `{ok: true}`) and `version(&self) -> Result<VersionInfo, SetuError>` with `VersionInfo { version: String, mode: String, audit: bool }`.
- Never print, log or put params into error messages. The `auth` token must not appear in any `Debug` or `Display` output.

**Errors (`errors.rs`).** `#[derive(Debug, thiserror::Error)] enum SetuError`, mapped by numeric `code` (AD-2). Keep `message` and `data.kind` where present.

| Code | `data.kind` | Variant |
| --- | --- | --- |
| -32700, -32600, -32601, -32602, -32603 | | `Protocol { code, message }` |
| -32001 | | `Unauthorized` |
| -32010 | `denied` | `Denied { code, kind, message }` |
| -32011 | `unavailable` | `Unavailable` |
| -32012 | `not_paired` | `NotPaired` |
| -32013 | `bad_code` | `BadCode` |
| -32014 | `revoked` | `Revoked` |
| -32015 | `token_invalid` | `TokenInvalid` |
| -32016 | `token_expired` | `TokenExpired` |
| -32017 | `no_grant` | `NoGrant` |
| -32018 | `blocked` | `Blocked` |
| -32020 | `no_session` | `NoSession` |
| -32021 | `audit_disabled` | `AuditDisabled` |
| -32022 | `cancelled` | `Cancelled` |
| -32023 | `adb_pair_failed` | `AdbPairFailed` |
| -32024 | `unsupported` | `Unsupported` |
| -32025 | `session_expired` | `SessionExpired` |
| -32026 | `peer_closed` | `PeerClosed` |
| -32027 | `busy` | `Busy` |
| any other code (e.g. -32019, -32099) | anything | `Denied { code, kind, message }` (raw, never guessed) |

Plus client-side variants: `FrameTooLarge`, `Disconnected`, `Io(std::io::Error)` (connect failure only), `UnexpectedResult` (a result that does not match the typed helper's shape). Add `fn code(&self) -> Option<i64>`. Nothing else: no UI copy, no retry policy beyond busy, no `is_retryable` helpers.

**FakeDaemon (`tests/support/fake_daemon.rs`).** Binds `127.0.0.1:0`, returns its `SocketAddr`. Tests script it: reply to method X with a result or an error object, delay a reply, reply to two requests in reverse order, push a notification, send raw bytes (split a line, send an oversize line), and close the socket. Record the requests it received so tests can assert ids and retries. Keep it as small as the tests need.

## 4. TDD: write these tests first, see them fail, then implement

Name tests after what they prove. Map each to its acceptance ID in a comment.

- `framing`: split line across 3 chunks → one line; two lines in one chunk → two; empty lines skipped; exactly 1 MiB line OK; 1 MiB + 1 → `FrameTooLarge` (decode); encode over cap → `FrameTooLarge` and nothing written.
- P11 mapping: a table-driven test over every row above, including -32022, -32024, -32025, -32026, -32027, plus an unknown code with an unknown kind → `Denied` with the raw code and kind preserved.
- Out-of-order: two concurrent calls, the fake answers id 2 before id 1, each caller gets its own result.
- Busy: first reply `-32027` then a result → `call` returns the result; the fake saw two requests with different ids. Busy twice → `SetuError::Busy`; exactly two requests sent.
- Notifications: an `event` and an `events.dropped` pushed by the fake arrive on the channel in order, with params intact.
- Disconnect: the fake closes while a call is pending → `Disconnected`; a later call → `Disconnected`; the channel ends. Same for an oversize incoming line.
- `auth` OK and `-32001` → `Unauthorized`; `version` parses `{version, mode, audit}`.
- Secrets: `format!("{:?}", err)` for a failed `auth` does not contain the token.

## 5. Gates (all must pass before you push)

From `src-tauri/`:

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

There is no TypeScript in this ticket, so ESLint, Prettier and Vitest do not apply yet.

## 6. Karpathy pillars (enforced at review)

1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. List every assumption you made. If the ticket, this prompt and `API_SPEC.md` disagree, or something is ambiguous, stop and ask in the PR or chat before coding around it. Do not silently guess.
2. **Simplicity first.** Minimum clear code for this ticket. No speculative features (no reconnect, no request cancellation API, no tracing, no generic transport trait, no builder types). No single-use abstractions. Files stay under ~250–300 lines; split cleanly if larger.
3. **Surgical changes.** Touch only the files in §2. Do not edit docs, the prototype or README. Branch from latest `main` as `feature/DT-01-jsonrpc-client`. Atomic conventional commits, for example `test(desktop): add rpc framing and error-mapping tests` then `feat(desktop): add JSON-RPC client core`.
4. **Goal-driven TDD.** Commit the failing tests first (red), then the implementation (green). Paste the exact output of all three gate commands in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-01 JSON-RPC client core`, with this body:

```
Ticket: DT-01 (docs/TDD_TICKETS.md §5) · Acceptance: P11 (error table), framing/out-of-order/busy per ticket

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
<red run excerpt showing the new tests failing>
<full green output of cargo fmt --check, cargo clippy --all-targets -- -D warnings, cargo test>

## Out of scope (left for later tickets)
- daemon spawn/ready line/reconnect (DT-02), event typing (DT-03), session.cancel API (DT-04), redaction layer (DT-10)
```

Then **stop immediately**. Do not start DT-02, do not edit `docs/`, do not merge.
