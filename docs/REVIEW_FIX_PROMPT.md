# Review fix prompt · DT-01 · PR #3 (round 1)

You are the builder for `SumukhaK/Setu-Desktop` PR #3 (`feature/DT-01-jsonrpc-client`). The review asks for **one change**. Make it on the same branch, re-run the gates, push, and stop for re-review. Change nothing else.

Read first: `docs/CODEBASE_MEMORY.md` (AD-3), then `src-tauri/src/rpc/client.rs`.

## Required change: dropping the last `RpcClient` must close the connection

**Problem.** `run_connection` holds an `Arc<Shared>`, and `Shared` owns the only `UnboundedSender` for the outgoing queue. So the connection task always keeps the sender alive, `outgoing.recv()` never returns `None`, and the socket, the task and the notification sender live until the daemon hangs up. The reviewer reproduced this: after dropping the client and the receiver, the server-side socket was still open 2 s later.

That would leave DT-02's supervisor with no way to release a connection, because DT-01 has no close API. Every reconnect would leak an authenticated loopback connection and a task. The PR's Assumptions say "DT-02 owns lifecycle", but DT-02 can only own it if dropping the handle releases it.

**Fix (minimal, no new public API):**
- Give the connection task a `std::sync::Weak<Shared>` instead of an `Arc<Shared>`. Each time it dispatches a message or closes, upgrade the `Weak`. If the upgrade fails, every `RpcClient` is gone: end the task.
- When the last `RpcClient` drops, the `Shared` and its outgoing sender drop with it. `outgoing.recv()` then returns `None`, the loop breaks, and the socket halves drop, which closes the TCP connection. The notification sender drops when the task ends.
- Keep every existing behaviour and test unchanged (AD-3 disconnect semantics, busy retry, ordering).
- Don't add `Drop` impls, `close()`/`shutdown()` methods, cancellation tokens or watch channels.

**Test first (red, then green).** Add this to `src-tauri/tests/rpc_client.rs`, and use the fake daemon if it can observe EOF; otherwise use a bare `TcpListener` as below:

```rust
// AD-3: dropping every client handle releases the connection.
#[tokio::test]
async fn dropping_every_client_handle_closes_the_connection() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (client, notifications) = RpcClient::connect(listener.local_addr().unwrap()).await.unwrap();
    let (mut server_side, _) = listener.accept().await.unwrap();
    let extra = client.clone();
    drop(client);
    drop(extra);
    drop(notifications);
    let mut byte = [0u8; 1];
    let read = timeout(TEST_TIMEOUT, server_side.read(&mut byte)).await;
    assert!(matches!(read, Ok(Ok(0))), "connection still open after the last handle dropped");
}
```

Also add a sibling assertion: while one clone is still alive, the connection stays open (a `call` on the remaining clone still succeeds).

## Optional (do it only if it stays small)

Three tests use `sleep(...)` to "let the request reach the fake". If it takes under ~15 lines, replace them with a `FakeDaemon::wait_for_requests(n)` that polls `received()` under the existing timeout. Otherwise leave them.

## Gates

From `src-tauri/`:

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## Commits and hand-off

- Write one `test(desktop): …` commit with the failing test, then one `fix(desktop): close the connection when the last RpcClient is dropped`.
- Push to the same branch. Edit the PR's "Assumptions & Trade-offs" to replace the "dropping the last clone does not close the connection" bullet with the new behaviour. Under "Test evidence", append "Round 2" with the red excerpt and the full green output.
- Then **stop**. Don't merge, don't edit `docs/`, and don't start DT-02.
