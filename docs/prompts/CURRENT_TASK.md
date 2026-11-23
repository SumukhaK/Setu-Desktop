# Builder prompt · DT-09 · Tray and background

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-14).
2. `docs/TDD_TICKETS.md` §5 "DT-09".
3. `docs/JOURNEYS.md`: the background paragraph ("Minimize desktop to the system tray…") and row P17. `docs/SCREENS.md` row D07 (tray restore only).
4. Setu-SDK v1.1.0 `API_SPEC.md` §2 (`session.list`, `session.stop`): https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
5. Existing code you'll use:
   - `src-tauri/src/app/mod.rs` (the `shell` module: `AppState`, `ready_client`, the single-instance handler, `run()`)
   - `src-tauri/src/commands/session.rs` (`stop_session`, `StopOutcome`)
   - `src-tauri/src/events/model.rs` (`parse_session_list`, `SessionInfo`)
   - `src-tauri/src/daemon/supervisor.rs` (`Supervisor::stop`)
   - `src-tauri/tests/support/fake_daemon.rs`
   - `src/App.tsx`, `src/app/WorkspacePage.tsx`, `src/platform/tauri.ts`, `src/main.tsx`, `src/features/pair/PairDialog.tsx` (the dialog markup pattern)
6. Tauri v2 tray and window-event docs: https://v2.tauri.app/learn/system-tray/

**Facts this ticket relies on (verified on `main` and against SDK v1.1.0 by the reviewer):**
- Daemon v1.1.0 has **no shutdown RPC**. Its method table (`core/internal/daemon/daemon.go`) is `auth.set_token`, `version`, `doctor`, `identity.public_key`, `devices.*`, `session.connect|pair_adb|cancel|list|stop`, `events.*` and `audit.*`.
- `Supervisor::stop()` kills and waits for a daemon **this app spawned**. For a daemon it **attached** to, it only drops the client. Dropping a `Supervisor` without `stop()` never kills the daemon (P17). That rule stays.
- So "Quit stops the daemon" means: end every live session with `session.list` then `session.stop`, then call `Supervisor::stop()`. An attached daemon is left running with no sessions. That gap goes to the SDK asks (§7 of TDD_TICKETS); don't kill a pid from the attach record.
- `session.list` returns an array of `SessionInfo`; `[]` when empty. `session.stop` returns `{}`; an unknown id returns `-32012` (`NoSession`).
- The hub (`EventHub::resync()`) re-sends a fresh snapshot. Calling it on restore is the `session.list on restore` binding.
- CI's Linux image already installs `libayatana-appindicator3-dev`.

## 1. Goal

Closing the window hides it to the system tray. The daemon, the event hub and every live session keep running (P17). The tray icon has **Show Setu** and **Quit Setu**, and a left click shows the window. Restoring returns to the same page and the same live sessions, with a fresh snapshot. The Workspace page gets a **Move to tray** button.

**Quit** ends all live sessions and stops the daemon. When sessions are live, the user confirms first, with copy that says they will end. With no live sessions, Quit happens at once.

Out of scope:
- Autostart at login.
- Tray badges, a session list in the tray menu, and notifications.
- macOS dock behaviour.
- Corporate (DT-14).
- Killing an attached daemon by pid.

## 2. Files (create or change only these)

```
src-tauri/Cargo.toml                    tauri features += "tray-icon" (a feature, not a new crate)
src-tauri/Cargo.lock                    whatever that feature pulls in
src-tauri/src/commands/quit.rs          pure async end_all_sessions + QuitOutcome; QuitLatch
src-tauri/src/commands/mod.rs           pub mod quit; re-exports
src-tauri/tests/quit_commands.rs        FakeDaemon tests (§4)
src-tauri/src/app/tray.rs               #[cfg(not(test))]: tray icon + menu, show_main()
src-tauri/src/app/mod.rs                close → hide; commands window_hide, app_quit; resync on restore; quit-requested event
src/app/windowLifecycle.ts              WindowPort type
src/app/QuitConfirm.tsx (+ .test.tsx)   the confirm dialog
src/app/WorkspacePage.tsx               + optional onMoveToTray → "Move to tray" button in the page heading
src/App.tsx, src/App.test.tsx           optional windowPort; quit flow
src/platform/tauri.ts                   + tauriWindowPort
src/main.tsx                            pass windowPort={tauriWindowPort}
```

AD-1 keeps Tauri code inside `src-tauri/src/app/`, so the tray goes in `app/tray.rs`, not the tracker's `src/tray.rs`. Don't touch `daemon/`, `rpc/`, `events/`, `adb/`, `store/`, `capabilities/`, `tauri.conf.json`, the feature components under `src/features/`, `src/state/`, `docs/`, `README.md`, the prototype or CI. Add no crate and no npm package.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Rust: `commands/quit.rs` (no tauri import; AD-1).**

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum QuitOutcome {
    NotReady,                                  // no Ready client: nothing to end
    Ended { stopped: usize, failed: usize },   // NoSession counts as stopped
    ListFailed { code: Option<i64> },
}

pub async fn end_all_sessions(client: Option<RpcClient>) -> QuitOutcome;

#[derive(Default)]
pub struct QuitLatch(AtomicBool);
impl QuitLatch { pub fn try_begin(&self) -> bool; }   // true exactly once
```

- `end_all_sessions` calls `session.list` once. Then it calls `stop_session` for each `session_id`, one after another, and **continues past a failure**.
- `StopOutcome::Stopped` and `NoSession` count as stopped. Everything else counts as failed.
- It never returns early after a stop error.

**Rust: shell (`app/mod.rs`, `app/tray.rs`).**
- `tray.rs`:
  - Build one tray icon with the app's default window icon, tooltip "Setu", and a menu of **Show Setu** (`id "show"`) and **Quit Setu** (`id "quit"`).
  - A left click and **Show Setu** call `show_main(app)`.
  - **Quit Setu** calls `show_main(app)`, then emits `"quit-requested"` (payload `()`) to the main window.
- `show_main(app)`:
  - unminimize, show and focus the `"main"` window
  - call `hub.resync()` when a hub exists
  - The existing single-instance handler calls `show_main` too.
- `on_window_event`: `WindowEvent::CloseRequested` on `"main"` → `api.prevent_close()` and `window.hide()`. Don't intercept `RunEvent::ExitRequested`: an OS logout may still end the app, and P17 keeps the daemon alive then.
- Command `window_hide()` hides `"main"`.
- Command `app_quit()`:
  - `QuitLatch::try_begin()`. If it returns false, return at once (no double quit).
  - `tokio::time::timeout(5 s, end_all_sessions(ready_client(..)))`, ignoring the result.
  - Then `supervisor.stop().await` when a supervisor exists, then `app.exit(0)`.
  - The user has already confirmed, so a failure or timeout never blocks quitting.
- Add `QuitLatch` to `AppState`. No new capability: everything goes through custom commands and one event, which `core:default` already allows.

**UI.**
- `windowLifecycle.ts`:

  ```ts
  export interface WindowPort {
    hide(): Promise<void>;
    quit(): Promise<void>;
    onQuitRequested(cb: () => void): Promise<() => void>; // resolves to unsubscribe
  }
  ```

  `tauriWindowPort` implements it with `invoke("window_hide")`, `invoke("app_quit")` and `listen("quit-requested")`. It's the only Tauri import (AD-9).
- `App` takes `windowPort?: WindowPort` and holds `const [quitRequested, setQuitRequested] = useState(false)`.
  - **Subscribe** once in an effect to `onQuitRequested(() => setQuitRequested(true))`, and unsubscribe on cleanup. Handle a late resolve after unmount, the same way `useDaemonStatus` does.
  - **No live sessions:** an effect calls `windowPort.quit()` once, guarded by a ref, while `quitRequested && live.length === 0`.
  - **Live sessions:** render `<QuitConfirm count={live.length} onQuit={…} onCancel={() => setQuitRequested(false)} />` above the page content (a child of `Shell`, before the page), on whichever page is showing.
- `QuitConfirm`:
  - Markup: `<div role="alertdialog" aria-labelledby="quit-title" aria-describedby="quit-body" className="dialog">`, using the same `dialog-head`, `dialog-body` and `dialog-actions` classes as `PairDialog`.
  - Title `<h2 id="quit-title">`: "Quit Setu?"
  - Body: "1 live session will end." or "{n} live sessions will end.", then " Setu stops the local service on this computer."
  - Buttons:
    - **Quit** (`button primary danger`) calls `onQuit` once and disables itself, showing "Quitting…".
    - **Cancel** (`button quiet`) calls `onCancel`.
  - **Cancel** receives focus on mount. Escape calls `onCancel`.
- `WorkspacePage` gets optional `onMoveToTray?: () => void`. When it's given, the page heading shows **Move to tray** (`button secondary`) next to the title block. `App` passes `() => void windowPort.hide()` only when `windowPort` is given.
- No inline styles and no new CSS. The existing `.dialog*`, `.page-heading` and `.button*` rules cover it.

## 4. TDD: write these tests first, see them fail, then implement

- **`tests/quit_commands.rs`** (FakeDaemon, every wait under `tokio::time::timeout`):
  - `None` client → `NotReady` and no request sent.
  - `session.list` → `[]` → `Ended{0, 0}`, and no `session.stop` sent.
  - Two sessions `s1`, `s2` → two `session.stop` requests carrying exactly those ids, in list order → `Ended{2, 0}`.
  - `s1` stop returns `-32012` and `s2` returns `-32603` → `Ended{stopped: 1, failed: 1}`, and the `s2` stop was still sent.
  - `session.list` error `-32603` → `ListFailed{code: Some(-32603)}` and no stop sent.
  - `QuitLatch`: the first `try_begin` is true; the second and a concurrent third are false.
- **`QuitConfirm.test.tsx`:**
  - The singular and plural copy.
  - **Cancel** is focused on mount.
  - Escape and **Cancel** call `onCancel`.
  - A double click on **Quit** calls `onQuit` once and shows "Quitting…".
- **`App.test.tsx`** (fake `WindowPort` whose `onQuitRequested` stores the callback):
  1. No live sessions: firing quit-requested calls `quit()` once and shows no dialog.
  2. One live session: firing it shows "1 live session will end."; **Cancel** hides the dialog and `quit` was not called; firing it again and pressing **Quit** calls `quit()` once.
  3. The confirm also appears while the Devices page is showing.
  4. **Move to tray** calls `hide()`. Without a `windowPort`, the button is absent and no subscription happens.
  5. Unmount calls the unsubscribe.
- **Manual (`npm run tauri dev`, name the OS):**
  - closing the window keeps the tray icon and the daemon process
  - **Show Setu** restores the same page
  - with a paired phone, a live session survives hide and restore
  - **Quit Setu** with a session shows the confirm, and Quit ends the session on the phone and exits
  - without a session it exits at once
  
  If you can't pair a phone, say so.

## 5. Gates (all must pass before you push)

From the repo root:

```
npm ci
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

From `src-tauri/` (unchanged code, but prove it):

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

All three CI jobs (`gates-linux`, `gates-windows`, `e2e-linux`) must be green on the PR head. Use no `#[allow(...)]`, no `unwrap()` outside tests, no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no non-null `!`, and no inline styles. If a gate fails for a reason you can't fix in code, stop and report the exact error.

**Manual check:** with `npm run tauri dev` and a real daemon, if you can pair a phone, press **End** on the phone and confirm the notice appears and nothing reconnects until you press **Reconnect**. If you can't pair a phone, say so and name the OS.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** Rust owns the window, the tray, ending sessions and stopping the daemon. React only asks (`window_hide`, `app_quit`) and confirms. The session list used for Quit comes from the daemon, not from the UI's store (AD-1, AD-9).
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`, including how Linux tray support behaved on your machine.
2. **Simplicity first.** One pure Rust module, one tray file, one dialog, one port. No plugin crates (no `tauri-plugin-window-state`, `-autostart` or `-dialog`), no native message box, no timers in the UI.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-09-tray`, with atomic commits:
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first. Paste the red excerpt, the green gate output, the CI links and the manual check in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-09 tray and background`, with this body:

```
Ticket: DT-09 (docs/TDD_TICKETS.md §5) · Acceptance: P17 (close hides, daemon and session survive, restore returns to the same session, Quit confirms then stops sessions and the daemon)

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<green gate output>
<CI run links>
<manual tray check, or "no phone available" for the session part>

## Out of scope (left for later tickets)
- autostart, tray session list, notifications, killing an attached daemon (needs an SDK shutdown RPC), robustness nits (UK-04)
```

Then **stop immediately**. Don't start UK-04, don't edit `docs/`, and don't merge.
