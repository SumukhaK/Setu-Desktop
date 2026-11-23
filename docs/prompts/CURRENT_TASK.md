# Builder prompt · UK-03 · Solo end states and Reconnect

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-14).
2. `docs/TDD_TICKETS.md` §5a "UK-03".
3. `docs/JOURNEYS.md`: the error table rows `-32025` and `-32026`, and row P10. `docs/SCREENS.md` row D07 (end states and manual **Reconnect** only).
4. Setu-SDK v1.1.0 `API_SPEC.md` §1.5 (`session_down`, `peer_closed`, `session_expired`): https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
5. Existing code you'll use:
   - `src/state/sessionStore.ts` (`EndedSession`, `EndReason`, the `session_down` / `peer_closed` / `session_expired` branch)
   - `src/features/devices/devicesPort.ts` (`DevicesPort.connect(deviceId)`, `connectMessage`)
   - `src/app/WorkspacePage.tsx`, `src/App.tsx`, `src/styles/app.css` (`.notice`, `.notice.warning`, `.button*`)
   - `src/features/session/RejoinBanner.tsx` (the pattern for a notice with **Dismiss**)

**Facts this ticket relies on (already true on `main`):**
- The bridge already forwards `session_down {session, abnormal}`, `peer_closed {session, device_id, peer_reason}` and `session_expired {session, device_id, reason}`. **No Rust change is needed or allowed.**
- The store already moves a live session into `ended` (newest first, at most 20) with `reason` `closed` | `error` | `peer_closed` | `session_expired`, and ignores the event when the session isn't live. So a `session_down` that follows `peer_closed` for the same session adds nothing.
- A snapshot keeps `ended` as it is.
- `session.stop` (the card's **Disconnect**) ends with `session_down {abnormal: false}`, so reason `closed`.
- DT-08's `DevicesPort.connect(deviceId)` returns a `ConnectOutcome`; `connectMessage(outcome)` gives the failure text, or `null` for `connected`.

## 1. Goal

Today a session that ends on the phone, expires or drops makes its card vanish without a word. After this ticket, the Workspace page shows one notice for each such ended session, above the session cards. Each notice has **Dismiss** and, when the device is known, a manual **Reconnect**. A normal close shows nothing. Nothing retries automatically.

Out of scope:
- Corporate codes `-32014`..`-32018`, SSO and the "Your organization's…" wording (DT-16).
- Tray (DT-09).
- Toasts, animation and new CSS beyond reusing `.notice`.
- Persisting notices across restarts.

## 2. Files (create or change only these)

```
src/state/sessionStore.ts                 EndedSession gains peerReason: string | null
src/state/sessionStore.test.ts            + the store cases in §4
src/features/session/EndedNotice.tsx      one notice per ended session
src/features/session/EndedNotice.test.tsx
src/app/WorkspacePage.tsx                 render the notices between the session count line and the session cards
src/App.tsx, src/App.test.tsx             dismissed set held in App; pass ended, live device ids and devicesPort down
```

Don't touch `src-tauri/`, `src/platform/`, any `*Port.ts`, `useSessions.ts`, `RejoinBanner.tsx`, `SessionCard.tsx`, `src/features/devices/*`, `src/features/pair/*`, `src/styles/app.css`, `docs/`, `README.md`, the prototype or CI. Add no npm package.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Store.**
- `EndedSession` gains `peerReason: string | null`.
- For `peer_closed`, set it to `peer_reason` when that is a non-empty string after trimming, otherwise `null`. For every other reason it's `null`.
- Nothing else in the reducer changes.

**`EndedNotice.tsx`.** Props:

```ts
{
  ended: EndedSession;
  canReconnect: boolean;            // deviceId !== null and a devicesPort exists
  reconnect: (deviceId: string) => Promise<ConnectOutcome>;
  onDismiss: (sessionId: string) => void;
}
```

- `reason === "closed"` renders `null`.
- Otherwise it renders `<div role="alert" className="notice warning">` with one sentence, then the buttons:
  - `peer_closed`: "The session was ended on the phone." When `peerReason` is not null, append ` Reason: {peerReason}`.
  - `session_expired`: "The session time limit was reached."
  - `error`: "The connection to the phone ended unexpectedly."
- **Reconnect** (`button primary`) shows only when `canReconnect`, and `ended.deviceId` is not null.
  - On click it calls `reconnect(deviceId)` once and disables itself, with the text "Reconnecting…", until the promise settles.
  - On `connected`, it does nothing more. The new live session hides the notice (see App).
  - On any other outcome, it re-enables the button and shows `connectMessage(outcome)` in a `<p>` inside the notice when that isn't `null` (`cancelled` shows nothing).
  - If the promise rejects, it re-enables the button and shows "Couldn't reach the Setu service. Try again."
- **Dismiss** (`button quiet`) calls `onDismiss(sessionId)`.
- No timers and no automatic retry.

**App and WorkspacePage.**
- `App` holds `const [dismissedEnded, setDismissedEnded] = useState<ReadonlySet<string>>(new Set())`, so dismissals survive a switch to Devices and back.
- The notices shown are `sessions.ended` filtered to:
  - `reason !== "closed"`
  - `sessionId` not in `dismissedEnded`
  - and `deviceId` is null **or** no live session has that `deviceId` (once the device is live again, its old notice is stale and hides on its own).
- They render newest first, in the order the store keeps them.
- `canReconnect` is `devicesPort !== undefined && ended.deviceId !== null`. `reconnect` is `devicesPort.connect`.
- `WorkspacePage` gets the filtered list plus `onDismissEnded` and `reconnect` props, and renders each `EndedNotice` with `key={sessionId}` between the count line and the first `SessionCard`.
- The count line and everything else on the page stay as they are.

**Styles.** Use the existing `.notice warning` and `.button` classes only. No new CSS, no inline `style={…}`.

## 4. TDD: write these tests first, see them fail, then implement

- **Store (`sessionStore.test.ts`):**
  - `peer_closed` with `peer_reason: "User ended"` stores `peerReason: "User ended"`; with `""` or `"  "` it stores `null`.
  - `session_expired` and `session_down` store `peerReason: null`.
  - `peer_closed` then `session_down` for the same session leaves exactly one `ended` entry, with reason `peer_closed`.
- **`EndedNotice.test.tsx`:**
  - Each reason shows its sentence. `closed` renders nothing (`container` is empty).
  - `peer_closed` with a reason shows "Reason: User ended"; without one it doesn't show "Reason:".
  - **Reconnect** is absent when `canReconnect` is false, and when `deviceId` is null.
  - Clicking **Reconnect** calls `reconnect` once with the device id and disables the button while it's pending; a double click doesn't call it twice.
  - A `not_paired` outcome re-enables the button and shows `connectMessage`'s text.
  - A rejected promise shows "Couldn't reach the Setu service. Try again."
  - **Dismiss** calls `onDismiss` with the session id.
- **`App.test.tsx` (fake hub, fake ports):**
  1. Snapshot one live session for `dev-1`, then `peer_closed {peer_reason: "User ended"}`: the card is gone, the notice shows with the reason, and no `connect` call happens on its own (no automatic retry).
  2. `session_expired` and `session_down {abnormal: true}` each show their notice. **Disconnect** (`session_down {abnormal: false}`) shows none.
  3. **Reconnect** calls `devicesPort.connect("dev-1")`. A later snapshot with a live session for `dev-1` hides the notice.
  4. **Dismiss** hides the notice. It stays hidden after switching to Devices and back.
  5. Without a `devicesPort`, the notice shows but has no **Reconnect**.
- No existing test may change, except where `EndedSession` literals now need `peerReason`.

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

All three CI jobs (`gates-linux`, `gates-windows`, `e2e-linux`) must be green on the PR head. Use no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no non-null `!`, and no inline styles. If a gate fails for a reason you can't fix in code, stop and report the exact error.

**Manual check:** with `npm run tauri dev` and a real daemon, if you can pair a phone, press **End** on the phone and confirm the notice appears and nothing reconnects until you press **Reconnect**. If you can't pair a phone, say so and name the OS.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** Rust already forwards the typed end events (AD-11). React derives notices from the store's `ended` list. Reconnect goes through the existing `DevicesPort`; there's no new port and no new command.
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`.
2. **Simplicity first.** One component and one set in App. No context provider, no timers, no new CSS. Keep files under ~250 lines.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `upkeep/UK-03-end-states`, with atomic commits:
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first. Paste the red excerpt and the green gate output in the PR, plus the CI links.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): UK-03 Solo end states and Reconnect`, with this body:

```
Ticket: UK-03 (docs/TDD_TICKETS.md §5a) · Acceptance: P10 desktop half (peer_closed end state, no auto retry), JOURNEYS -32025/-32026 Solo wording, D07 manual Reconnect

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<green gate output>
<CI run links>
<manual check, or "no phone available">

## Out of scope (left for later tickets)
- corporate codes and SSO (DT-16), tray (DT-09), robustness nits (UK-04)
```

Then **stop immediately**. Don't start DT-09, don't edit `docs/`, and don't merge.
