# Builder prompt · DT-03a · App shell and UI scaffold

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-9; AD-8 and AD-9 are new for this ticket).
2. `docs/TDD_TICKETS.md` §4 (stack) and §5 "DT-03a".
3. `docs/SCREENS.md`: the layout at the top and the status strip ("listener, local ADB and transport as independent facts"). This ticket shows only the daemon fact.
4. Tauri v2 docs for `tauri.conf.json`, capabilities and `tauri-plugin-single-instance`: https://v2.tauri.app
5. Existing code you'll use but not change: `src-tauri/src/daemon/` (`Supervisor`, `DaemonState`, `Workspace`, `DaemonConfig`) and `src-tauri/src/rpc/`.

## 1. Goal

`cargo tauri dev` opens one window titled "Setu". The app starts the Solo daemon supervisor and shows a one-line daemon status that updates live. A second launch focuses the first window instead of starting another app. The repo gets the UI toolchain and gates that every later desktop ticket builds on. There's no sidecar bundling (DT-17), no events subscription (DT-03b), no pairing, no tray, no settings UI, and the prototype is untouched.

## 2. Files (create or change only these)

```
.gitignore                         + node_modules/, dist/, src-tauri/gen/
package.json, package-lock.json    scripts: dev, build, tauri, typecheck, lint, format:check, test
tsconfig.json                      strict: true, noUncheckedIndexedAccess: true, jsx react-jsx
vite.config.ts                     root "src", build.outDir "../dist" (emptyOutDir), server.port 5173 strictPort, Vitest: environment jsdom, setupFiles
eslint.config.js                   flat config: @eslint/js recommended + typescript-eslint strictTypeChecked + react-hooks; "@typescript-eslint/no-explicit-any": "error"; ignore dist, src-tauri, index.html, prototype.js, styles.css, docs
.prettierrc.json, .prettierignore  ignore the prototype files, docs/, src-tauri/, dist/
src/index.html                     Vite entry (title "Setu")
src/main.tsx                       createRoot → <App port={tauriDaemonPort} />
src/App.tsx                        "Setu" heading + <StatusStrip />
src/daemon/status.ts               DaemonStatus type, statusLabel(), useDaemonStatus(port)
src/daemon/StatusStrip.tsx
src/platform/tauri.ts              the only file that imports @tauri-apps/api (AD-9): tauriDaemonPort
src/test/setup.ts                  @testing-library/jest-dom
src/daemon/status.test.ts
src/daemon/StatusStrip.test.tsx
src-tauri/Cargo.toml               + tauri 2, tauri-plugin-single-instance 2, [build-dependencies] tauri-build 2; [lib] name setu_desktop; [[bin]] setu-desktop (src/main.rs); default-run = "setu-desktop"; keep fake-setu-daemon bin
src-tauri/build.rs                 tauri_build::build()
src-tauri/tauri.conf.json          productName Setu, identifier dev.setu.desktop, one window "Setu", frontendDist ../dist, devUrl http://localhost:5173, beforeDevCommand/beforeBuildCommand npm scripts, strict CSP (below), NO bundle.externalBin
src-tauri/capabilities/default.json   main window: core:default only
src-tauri/icons/*                  generated with `npx tauri icon` from one placeholder PNG (commit the generated set)
src-tauri/src/main.rs              thin: setu_desktop::app::run()
src-tauri/src/lib.rs               + pub mod app;
src-tauri/src/app/mod.rs           run(): builder, single-instance, setup (resolve config, start supervisor, forward state), command
src-tauri/src/app/status.rs        AppStatus + mapping + resolution helpers (pure, unit-tested)
```

Don't change `src-tauri/src/daemon/`, `src-tauri/src/rpc/`, their tests, `docs/`, `README.md` or the prototype (`index.html`, `prototype.js`, `styles.css`).

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Pure core (`app/status.rs`).**

```rust
#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum AppStatus {
    NotConfigured,                                   // no relay URL (AD-8)
    Starting,
    Ready { version: Option<String>, attached: bool, generation: u64 },
    Restarting { attempt: u32, retry_in_ms: u64 },
    Failed { reason: String },
    Stopped,
}

pub fn status_of(state: &DaemonState, version: Option<String>) -> AppStatus;
pub fn resolve_daemon_path(env_override: Option<OsString>, exe_dir: &Path) -> PathBuf;   // env wins; else exe_dir/"setu-daemon" (+ ".exe" on Windows via std::env::consts::EXE_SUFFIX)
pub fn resolve_relay(runtime: Option<String>, compile_time: Option<&'static str>) -> Option<String>;  // first non-blank, trimmed
```

`AppStatus` must never carry the token, the proxy URL or a pairing code. `Failed.reason` is passed through from the supervisor, which already keeps secrets out. `Debug` is fine here because the type holds no secrets.

**`app/mod.rs`.**
- `pub fn run()`: `tauri::Builder::default()`.
  - Register `.plugin(tauri_plugin_single_instance::init(|app, _, _| focus the "main" window))` first.
  - Register `.invoke_handler(generate_handler![daemon_status])`.
  - In `.setup(...)`:
    1. Resolve the relay with `resolve_relay(std::env::var("SETU_RELAY_URL").ok(), option_env!("SETU_RELAY_URL"))`.
    2. With no relay, store `NotConfigured` and start nothing.
    3. Otherwise build a `DaemonConfig` with:
       - `daemon_path = resolve_daemon_path(env::var_os("SETU_DAEMON_PATH"), <current_exe dir>)`
       - `relay`
       - `label = Some(<computer name>)`. Use the `COMPUTERNAME` or `HOSTNAME` env var, else `None`. Add no crate for this.
       - every other field `None`
    4. Then `Supervisor::start(Workspace::Solo, app.path().app_data_dir()?, config, SupervisorOptions::default())`.
- **State forwarding.** Spawn one async task on Tauri's runtime (`tauri::async_runtime::spawn`) that loops over `subscribe()` changes:
  - For a `Ready` with a new `generation`, call `client.version()` once and keep `Some(version)` on success.
  - Map with `status_of`, store the result in a `Mutex<AppStatus>` held in managed state, and `emit("daemon-status", &status)`.
- `#[tauri::command] fn daemon_status(state) -> AppStatus` returns the stored value, so a UI that loads late still gets the current state.
- Don't call `stop()` on window close or app exit. The daemon outlives the window (P17; DT-09 adds tray and quit).
- Keep the `Supervisor` handle in managed state so it lives as long as the app.

**`tauri.conf.json` CSP.** Set `"csp": "default-src 'self'; connect-src ipc: http://ipc.localhost; style-src 'self'; img-src 'self'"`. Leave `withGlobalTauri` false.

**UI (AD-9).**

```ts
export type DaemonStatus =
  | { state: "not_configured" } | { state: "starting" }
  | { state: "ready"; version: string | null; attached: boolean; generation: number }
  | { state: "restarting"; attempt: number; retry_in_ms: number }
  | { state: "failed"; reason: string } | { state: "stopped" };

export interface DaemonPort {
  current(): Promise<DaemonStatus>;
  subscribe(onStatus: (s: DaemonStatus) => void): Promise<() => void>;   // returns unsubscribe
}
```

- `useDaemonStatus(port)` returns `DaemonStatus | null`:
  - It reads `current()` once and subscribes.
  - A pushed status always wins over a late `current()` result.
  - It unsubscribes on unmount.
- `statusLabel(s)` returns:
  - "No relay configured"
  - "Starting the Setu service…"
  - "Setu service ready · v1.1.0" (when `version` is null, show "Setu service ready")
  - "Restarting the Setu service (attempt N) in X s", where X = ceil(ms / 1000)
  - "Setu service failed: <reason>"
  - "Setu service stopped"
- `StatusStrip` renders `statusLabel` in a `role="status"` element, showing "Checking…" while the status is null.
- `src/platform/tauri.ts` implements `DaemonPort` with `invoke("daemon_status")` and `listen("daemon-status")`. No other file imports `@tauri-apps/api`.
- Plain CSS is fine. No UI library, no router and no state library.

**Package scripts.**

```
"dev": "vite", "build": "tsc --noEmit && vite build", "tauri": "tauri",
"typecheck": "tsc --noEmit", "lint": "eslint .", "format:check": "prettier --check .", "test": "vitest run"
```

## 4. TDD: write these tests first, see them fail, then implement

- **Rust (`app/status.rs` unit tests):**
  - `status_of` covers every `DaemonState` variant: `Ready` keeps `attached`, `generation` and the version passed in, and `Restarting` converts `retry_in` to ms.
  - `serde_json::to_value(AppStatus::Ready{..})` has `"state":"ready"`. Assert the JSON field names the UI relies on.
  - `resolve_daemon_path` prefers the env value, and otherwise returns `exe_dir.join("setu-daemon" + EXE_SUFFIX)`.
  - `resolve_relay`: runtime wins, blank or whitespace values are skipped, compile-time is the fallback, and both missing give `None`.
  - Build a `Ready` value with a real `RpcClient` from the existing `FakeDaemon` pattern. If that needs the integration-test support module, put the `status_of` test for `Ready` in `src-tauri/tests/app_status.rs` and use `tests/support/fake_daemon.rs` (adding the file to §2 is allowed for this one test).
- **UI (Vitest + Testing Library, with a fake `DaemonPort`):**
  - `statusLabel` table for all six states, including null version and the ceil of 2500 ms.
  - `useDaemonStatus`:
    - `current()` resolves "starting", then a pushed "ready" shows ready.
    - A pushed status that arrives **before** a slow `current()` isn't overwritten by it.
    - Unmount calls the unsubscribe function.
  - `StatusStrip` shows "Checking…" first, then the label, in `role="status"`.
  - The rendered DOM contains no input element.

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

Also run `npm run tauri dev` once on your OS. Confirm in the PR that the window opens with the title "Setu" and the strip shows either "No relay configured" (no env) or a live state with `SETU_RELAY_URL` and `SETU_DAEMON_PATH` set. Also confirm that a second launch focuses the first window. Name the OS.

Use no `#[allow(...)]`, no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, and no clippy or lint downgrades. If a gate fails for a reason you can't fix in code (for example, Tauri needing system libraries on Linux), stop and report the exact error.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** The token, process control and daemon RPC stay in Rust. React sees only `AppStatus` through one command and one event. The UI depends on `DaemonPort`, not Tauri (AD-9).
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. If Tauri v2's behaviour differs from this prompt (config keys, plugin API, icon requirements), choose the closest v2-native equivalent, record it there, and stop only if it changes the contract.
2. **Simplicity first.** Write the minimum code: no router, no state library, no UI kit, no logging crate, no workspace switcher, no settings, and no sidecar. Keep files under ~250–300 lines, and most of them much smaller.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-03a-app-shell`. Make atomic conventional commits:
   - `chore(desktop): …` for the toolchain scaffold (configs, package files, icons) with no behaviour
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first, then the implementation. Paste the red excerpt and the full green output of every gate in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-03a app shell and UI scaffold`, with this body:

```
Ticket: DT-03a (docs/TDD_TICKETS.md §5) · Acceptance: daemon status surfaced (P18 visible), single instance, P17 (no stop on close)

## Assumptions & Trade-offs
- …

## What changed
- one line per file (group generated icons in one line)

## Test evidence
OS: …
<red run excerpt>
<full green output of every gate>
<tauri dev manual check: window title, strip text, second launch focuses>

## Out of scope (left for later tickets)
- events hub and session store (DT-03b), tray and quit (DT-09), settings incl. relay URL (DT-12), sidecar packaging (DT-17)
```

Then **stop immediately**. Don't start DT-03b, don't edit `docs/`, and don't merge.
