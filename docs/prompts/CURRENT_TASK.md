# Builder prompt · UK-04 · Robustness nits

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-14).
2. `docs/TDD_TICKETS.md` §5a "UK-04".
3. Existing code you'll change (read each fully before editing):
   - `src/features/pair/PairDialog.tsx` (+ test)
   - `src/features/devices/DeviceList.tsx`, `DeviceDetail.tsx` (+ tests)
   - `src/features/session/RejoinBanner.tsx` (+ test)
   - `src/App.tsx` (+ test): the pairing open flag and the DT-09 quit flow
   - `src-tauri/src/events/hub.rs`, `src-tauri/tests/event_hub.rs`
   - `src-tauri/src/app/tray.rs`
   - `src-tauri/build.rs`

**Facts this ticket relies on (verified on `main` by the reviewer):**
- `PairDialog.connect()` awaits `port.connect(code)` with no `try`. A rejected `invoke` leaves "Connecting…" on screen and Connect disabled forever.
- `DeviceList`'s load awaits `port.list()` with no `try`, so a rejection leaves the list blank with no message. `DeviceDetail.save()` awaits `port.setNickname` with no `try`. (`DeviceDetail.connect()` and `forget()` already catch.)
- `RejoinBanner`'s single timeout effect depends on `[session, clock]` only. If the timer fires a moment before `since + 10 s` by `clock.now()`, the redraw computes `none` and no new timer is armed, so holding never appears until the next event.
- `hub.rs` emits `HubMessage::Unavailable { generation }` on every failed `connect` and `events.subscribe` attempt, which means once per 1 s retry while the daemon is Ready but refusing.
- `build.rs` finds the profile dir as `OUT_DIR.ancestors().nth(4)`.
- DT-09: the tray uses Tauri's default `show_menu_on_left_click` (true), so on Windows a left click both opens the menu and restores the window.
- DT-09: if `windowPort.quit()` rejects, `App`'s `quitStarted` ref stays `true`, so Quit can never be retried in that window.
- `PairDialog` unmounts on a page switch; only App's open flag survives. A typed code is lost, and a connect still pending keeps running in Rust with no UI.

## 1. Goal

Seven small fixes, each with a failing test first where it can be tested. No behaviour changes beyond these.

## 2. Files (create or change only these)

```
src/features/pair/PairDialog.tsx (+ .test.tsx)
src/features/devices/DeviceList.tsx, DeviceDetail.tsx (+ tests)
src/features/session/RejoinBanner.tsx (+ .test.tsx)
src/App.tsx (+ App.test.tsx)
src-tauri/src/events/hub.rs, src-tauri/tests/event_hub.rs
src-tauri/src/app/tray.rs
src-tauri/build.rs
```

Don't touch any `*Port.ts` type, `src/platform/`, `src/state/`, `src/styles/`, `commands/`, `daemon/`, `rpc/`, `docs/`, `README.md`, the prototype or CI. Add no crate and no npm package.

## 3. Contract to implement (decided by the architect; do not reinterpret)

1. **Rejected invokes (UI).**
   - `PairDialog.connect()`: wrap the call in `try/catch/finally`. On a rejection, show "Couldn't reach the Setu service. Try again." in the existing alert, and always clear `connecting`.
   - `DeviceList` load: on a rejection, show "Couldn't load saved devices. Try again." in the existing message slot, keep **Refresh** enabled, and keep the stale-request guard (a late rejection from an older request is ignored).
   - `DeviceDetail.save()`: on a rejection, set `nicknameError` to "Couldn't save this nickname. Try again."
2. **RejoinBanner re-arm.** Keep the tick from `redraw` (`const [tick, redraw] = useState(0)`) and add it to the effect's deps (`[session, clock, tick]`), so every redraw re-evaluates `nextWakeAt` and arms a new timeout if the boundary hasn't passed yet. There's still one timer at a time and no interval.
3. **Hub `Unavailable` once per loss.**
   - Add `unavailable_sent: Option<u64>` to `Connection`. Route every `Unavailable` emit (the connect failure, the subscribe failure and `clear(.., announce: true)`) through one helper that emits only when `unavailable_sent != Some(generation)`, then records it.
   - Reset it to `None` when a snapshot is forwarded for that generation.
   - A new generation (daemon restart) may announce once again.
4. **`build.rs` profile dir.** Replace `.nth(4)` with: walk `out_dir.ancestors()` to the first directory whose file name equals `env::var("PROFILE")`, else return the existing error text naming `OUT_DIR`. Behaviour on the current layout is unchanged.
5. **PairDialog survives a page switch.** Lift the dialog's draft into `App`.
   - `App` holds `pairDraft: string` (initially `""`), passed to `PairDialog` as `draft` / `onDraftChange`. The dialog's input reads `draft` instead of its own `useState`.
   - Clear the draft when the dialog closes, and when a connect returns `connected`.
   - While a connect is pending, the rail's other item is still clickable. Leaving the page with a connect in flight cancels it, as **Cancel** does today (`port.cancel()` on unmount while `connecting`).
   - Add the minimal props needed. Don't change copy, roles or labels.
6. **Tray left click.** In `tray.rs`, set `.show_menu_on_left_click(false)`, so a left click only restores the window (Windows and macOS). Right click still opens the menu. Linux is unchanged (no click events there).
7. **Quit retry.** In `App`, if `windowPort.quit()` rejects:
   - reset `quitStarted` to `false` and `quitRequested` to `false`
   - show a `<p role="alert" className="notice">` above the page: "Couldn't quit Setu. Try again."
   - Dismiss the alert on the next quit request.

## 4. TDD: write these tests first, see them fail, then implement

- `PairDialog.test.tsx`: a rejecting `connect` shows the service message, hides "Connecting…" and re-enables Connect.
- `DeviceList` and `DeviceDetail` tests: a rejecting `list` shows the load message and **Refresh** works afterwards. A rejecting `setNickname` shows the save message.
- `RejoinBanner.test.tsx`: use a fake clock that lags the fake timers by 1 ms, so the first timeout fires at `since + 9 999` by `clock.now()`. Advancing 2 ms more shows holding, and `vi.getTimerCount()` stays ≤ 1 throughout.
- `event_hub.rs`: a FakeDaemon that answers `events.subscribe` with `-32603` and keeps the daemon Ready for ~3.5 s (3+ retries) yields exactly **one** `Unavailable` for that generation. A later successful subscribe + snapshot, then a loss, announces once more.
- `App.test.tsx`:
  - Type a code, switch to Devices and back: the input still holds the code.
  - A pending connect is cancelled when you leave Workspace.
  - Closing the dialog clears the draft.
  - A rejecting `quit()` shows "Couldn't quit Setu. Try again." and a second quit request calls `quit()` again.
- `build.rs` and `tray.rs` have no unit tests. CI `gates-windows` and a local `npm run tauri dev` left-click check on Windows are the evidence.

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

All three CI jobs (`gates-linux`, `gates-windows`, `e2e-linux`) must be green on the PR head. Use no `#[allow(...)]`, no `unwrap()` outside tests, no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no non-null `!`, and no inline styles. Every async wait in Rust tests is wrapped in `tokio::time::timeout`. If a gate fails for a reason you can't fix in code, stop and report the exact error.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** Rust fixes stay inside `events/hub.rs`, `app/tray.rs` and `build.rs`. UI fixes stay in their components plus App state. No new port methods and no new commands.
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`.
2. **Simplicity first.** One fix per item, smallest diff that makes its test pass. No refactors beyond them.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `upkeep/UK-04-robustness`, with atomic commits:
   - `test(desktop): …` red
   - `fix(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first. Paste the red excerpt, the green gate output and the CI links in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `fix(desktop): UK-04 robustness nits`, with this body:

```
Ticket: UK-04 (docs/TDD_TICKETS.md §5a) · seven items: rejected invokes, RejoinBanner re-arm, hub Unavailable once, build.rs profile dir, PairDialog draft across pages, tray left click, Quit retry

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<green gate output>
<CI run links>
<tray left-click check on Windows>

## Out of scope (left for later tickets)
- Android 11+ debugger pairing (DT-10), anything not in the seven items
```

Then **stop immediately**. Don't start DT-10, don't edit `docs/`, and don't merge.
