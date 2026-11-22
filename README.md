# Setu Desktop

Browser wireframes for the Setu desktop companion on Windows, macOS, and Linux. The selected design combines the Relay workspace layout with the Signal status strip. The strip keeps the authenticated local listener, local ADB attachment, and observed transport separate.

[Current workspace preview](docs/previews/current.png) · [Screen inventory and wireframes](docs/SCREENS.md) · [Canonical journeys and TDD acceptance tests](docs/JOURNEYS.md)

## Open the current prototype

Open `index.html` in a browser and use the scenario menu to review different SDK responses. Solo starts locally. Pair using the sample code shown in the pairing screen, or choose a saved device. Review **Android system pairing**, **Cancel a pending connection**, **Corporate presence**, and **Interrupted network path** in the scenario menu. Review **This Computer's Audit Log** and **Diagnostics** separately from the session workspace.

The wireframe uses fixtures. The canonical journeys specify which actions map directly to Setu-SDK v1.1.0 ([921aded](https://github.com/SumukhaK/Setu/commit/921aded)), which require native application work, and which depend on new SDK or organization services.

## Build the native core

The Rust native core lives in `src-tauri/`. It's a plain library for now; the Tauri app shell and the React UI arrive in later tickets. You need a stable Rust toolchain.

```sh
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## Real-daemon smoke test

`src-tauri/tests/e2e_real_daemon.rs` drives the Rust core against a real Setu-SDK v1.1.0 relay, phone agent and daemon. It reports a skip unless `SETU_E2E_BIN_DIR` is set, so the ordinary `cargo test` run stays fast. To run it locally, build the SDK binaries from the `v1.1.0` tag and point the test at them:

```sh
git clone --branch v1.1.0 --depth 1 https://github.com/SumukhaK/Setu.git ../Setu
cd ../Setu/core && go build -o "$HOME/setu-bin" ./cmd/setu ./cmd/setu-daemon
cd -
cd src-tauri && SETU_E2E_BIN_DIR="$HOME/setu-bin" cargo test --test e2e_real_daemon -- --nocapture
```

The test starts a loopback relay and phone agent, pairs by code, echoes a 24-byte ADB header through the tunnel, restarts the relay after a four-second outage, and checks stop, nickname, connect-by-id and forget. The same run is part of CI in `.github/workflows/ci.yml`.

Work is tracked ticket by ticket in [docs/TDD_TICKETS.md](docs/TDD_TICKETS.md). Builders start from [docs/prompts/CURRENT_TASK.md](docs/prompts/CURRENT_TASK.md).

<details>
<summary>Historical walkthrough from before the SDK audit</summary>

This earlier recording includes concepts superseded by the current wireframes, including email verification, phone approval, and evidence sharing.

https://github.com/user-attachments/assets/262dec47-998c-41a3-8a8a-dccc3fd21296

[Chapters and transcript](docs/walkthrough/TRANSCRIPT.md) · [English captions](docs/walkthrough/setu-walkthrough.en.vtt) · [Download MP4](docs/walkthrough/setu-walkthrough.mp4)

</details>
