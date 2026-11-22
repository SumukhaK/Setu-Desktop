# Builder prompt · DT-07 · Path and rejoin banners

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-13).
2. `docs/TDD_TICKETS.md` §4 (stack), §3 row P14 and §5 "DT-07".
3. `docs/JOURNEYS.md`: the "SDK binding · path events" paragraph in J5, and row P14.
4. `docs/SCREENS.md` row D07 (the holding and lost banners only).
5. Setu-SDK v1.1.0 `API_SPEC.md` §1.5 (`path_down`, `path_up`, `path_lost`, `retrying`, `session_down`): https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
6. Existing code you'll use: `src/state/sessionStore.ts` (it already keys `tunnels` by tunnel id), `src/state/clock.ts`, `src/state/useSessions.ts`, `src/features/session/` (`SessionCard`, `StatusStrip`, `transport.ts`), `src/features/adb/adbStatus.ts` (`attachmentOf`), `src/App.tsx`.

**Facts this ticket relies on (already true on `main`):**
- The bridge already forwards `path_down {session, tunnel_id, reason, transport}`, `path_up {session, tunnel_id, transport, outage_ms}` and `path_lost {session, tunnel_id, reason, outage_ms}`. `session` is the client session (`s1`), and `tunnel_id` is the 16-hex tunnel. **No Rust change is needed or allowed.**
- The SDK emits at most one `path_down` per tunnel outage, then exactly one `path_up` or `path_lost`. It sends `path_lost` after 90 s. A normal close emits none.
- The store already ignores path events for a session that isn't live, and any event for a tunnel that is already `lost`.
- `session_down`, `peer_closed` and `session_expired` already remove the session from `live`. `retrying` already shows "Listener: reconnecting" in the strip.

## 1. Goal

When a phone's path drops, the session card stays calm for the first 10 seconds. From 10 seconds until recovery, it shows an amber **holding** banner. On `path_up`, the banner clears and the strip's transport updates, which may switch, for example from `relay-wss` to `lan`. On `path_lost`, it shows a **lost** banner saying ADB will need to reattach. A session that ends (a denial, a peer close, expiry or `session_down`) takes its card and banner away, so a denial always wins over holding.

Only the SDK decides lost; the UI never escalates holding to lost on its own clock. There is no countdown and no RTT. There is no end-state screen (DT-16), no tray (DT-09) and no CSS beyond semantic markup.

## 2. Files (create or change only these)

```
src/state/sessionStore.ts                  TunnelState up/lost gain `at`; a repeated path_down keeps its original `since`
src/state/sessionStore.test.ts             + the cases in §4
src/features/session/rejoinMachine.ts      pure: HOLD_AFTER_MS, rejoinViewOf(), nextWakeAt()
src/features/session/rejoinMachine.test.ts P14 table
src/features/session/RejoinBanner.tsx      one banner per session, with one timer and no interval
src/features/session/RejoinBanner.test.tsx
src/features/session/SessionCard.tsx       + `clock` prop; render <RejoinBanner> between the heading and the StatusStrip
src/features/session/SessionCard.test.tsx  pass a clock; + the transport switch test
src/App.tsx, src/App.test.tsx              App takes an optional `clock` (default systemClock), passed to useSessions AND every SessionCard
```

Don't change `src-tauri/`, `src/platform/`, `src/features/adb/*`, `src/features/pair/*`, `StatusStrip.tsx`, `transport.ts`, `useSessions.ts`, `clock.ts`, `docs/`, `README.md` or the prototype. Add no npm package. `main.tsx` changes only if TypeScript forces it.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Store (`sessionStore.ts`).**

```ts
export type TunnelState =
  | { state: "up"; transport: string; at: number }
  | { state: "down"; since: number; reason: string; transport: string }
  | { state: "lost"; reason: string; at: number };
```

- `path_up` sets `{state: "up", transport, at: now}` and still sets `session.transport`.
- `path_lost` sets `{state: "lost", reason, at: now}`.
- `path_down` on a tunnel that is already `down` keeps the existing `since` (the first drop is t0) and only updates `reason` and `transport`. Otherwise it sets `{state: "down", since: now, …}`.
- Everything else stays as it is: the lost-tunnel guard, the unknown-session guard, the epoch and `synced` rules, and tunnels surviving a snapshot that still lists the session. `now` is the monotonic `Clock` value that `useSessions` already passes in.

**Rejoin machine (`rejoinMachine.ts`, pure, no React, no timers).**

```ts
export const HOLD_AFTER_MS = 10_000;

export type RejoinView =
  | { kind: "none" }
  | { kind: "holding" }
  | { kind: "lost"; tunnelId: string };

export function rejoinViewOf(
  session: LiveSession,
  now: number,
  dismissed: ReadonlySet<string>,
): RejoinView;

export function nextWakeAt(session: LiveSession, now: number): number | null;
```

`rejoinViewOf` per session (a tunnel goes idle → down(t0) → holding at t0 + 10 s → up or lost):
1. Find the `lost` tunnel with the largest `at` that is **not** in `dismissed` (the latest lost), and the `up` tunnel with the largest `at` (the latest up).
2. If a latest lost exists, and either there is no latest up or the lost `at` is greater than the up `at`, return `{kind: "lost", tunnelId}`.
3. Else, if any tunnel is `down` with `now - since >= HOLD_AFTER_MS`, return `{kind: "holding"}`.
4. Else return `{kind: "none"}`.

`nextWakeAt` returns the smallest `since + HOLD_AFTER_MS` that is greater than `now` among `down` tunnels, or `null`. That is the only moment the view can change without an event.

**Banner (`RejoinBanner.tsx`).** Props are `{ session: LiveSession; adb: AdbSnapshot | null; clock: Clock }`.
- Keep `dismissed` as local `useState<ReadonlySet<string>>`.
- Read `clock.now()` at render and compute `rejoinViewOf`.
- In an effect keyed on the session's tunnels, schedule **one** `setTimeout` for `nextWakeAt - clock.now()` that forces a re-render, and clear it on cleanup. No `setInterval` and no countdown text.
- `holding` renders a `<p role="status">` containing: "Phone connection interrupted. Setu is holding this session while it reconnects." When `attachmentOf(session.adbAddr, adb) === "attached"`, append " Local ADB is still attached." Otherwise append nothing, because attachment is claimed only while it can be observed.
- `lost` renders a `<div role="alert">` containing: "The phone is unreachable. ADB will need to reattach when it's back." It also has a **Dismiss** button that adds that `tunnelId` to `dismissed`. A later `lost` on another tunnel shows again.
- `none` renders nothing (`null`).

**SessionCard.** Add a `clock: Clock` prop. Render `<RejoinBanner session adb clock>` right after the heading. Nothing else on the card changes.

**App.** Give `App` an optional `clock?: Clock` prop (default `systemClock`). Pass the **same** clock to `useSessions` and to every `SessionCard`, because `since` and the banner must read one monotonic clock.

## 4. TDD: write these tests first, see them fail, then implement

Use `vi.useFakeTimers()` and a fake `Clock` whose `now()` reads a variable you advance together with `vi.advanceTimersByTime`, or `Date.now()` under fake timers. Never sleep in real time.

- **Store:**
  - `path_up` and `path_lost` stamp `at = now`.
  - A second `path_down` on a down tunnel keeps the first `since`.
  - After `path_lost`, a later `path_up` for that tunnel is ignored (stale tunnel).
  - A `path_down` for a session that isn't live is ignored.
  - A snapshot mid-outage keeps the `down` tunnel and its `since`.
- **rejoinMachine (P14 table):**
  - Down at t0; view at t0+9 999 → none; at t0+10 000 → holding.
  - Down at t0, up at t0+9 000 → none at every time (no flicker).
  - Down at t0, view at t0+50 000 → holding; up at t0+50 000 → none.
  - Down at t0, lost at t0+91 000 → lost. Down at t0 and no event by t0+200 000 → still holding (the UI never invents lost).
  - Two tunnels: A lost at 100, B up at 200 → none. A up at 100, B lost at 200 → lost(B). B dismissed → none, or holding when A is down for ≥ 10 s.
  - `nextWakeAt`: down at 1 000, now 4 000 → 11 000. At 11 000 → null. No down tunnels → null.
- **RejoinBanner (with fake timers):**
  - No text at 9 s. Holding text appears after advancing past 10 s with no new props.
  - "Local ADB is still attached." appears only for `attached`.
  - The lost alert shows; Dismiss hides it.
  - Unmount clears the timer: no pending timers (`vi.getTimerCount() === 0`).
- **SessionCard:** a `path_up` with `relay-wss`, then one with `lan`, changes "Transport: Relay (WSS)" to "Transport: LAN (direct)" and shows no banner.
- **App (fake hub, fake clock), denial overrides:**
  1. Snapshot one session, then `path_down`, then advance 15 s: holding is visible.
  2. Push `peer_closed` for that session: the card and the holding text are gone.
  3. Repeat with `session_expired`, and with `session_down {abnormal: true}`.

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

Also run `npm run tauri dev` once with a real `setu-daemon` v1.1.0. If you can pair a phone:
- Toggle the phone's Wi-Fi for about 5 s and confirm no banner appears.
- Toggle it for about 30 s and confirm holding appears, then clears.

If you can't pair a phone, say so. Name the OS.

Use no `#[allow(...)]`, no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no non-null `!` assertions, and no lint downgrades. If a gate fails for a reason you can't fix in code, stop and report the exact error.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** Rust already forwards typed path events (AD-11); this ticket adds no bridge shape. React derives the banner from store facts and one monotonic clock. Only the SDK's `path_lost` means lost.
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. If the daemon's path events differ from §0 when you run it, follow the daemon, add a test for it and record it.
2. **Simplicity first.** One pure module, one component and one timer. No state-machine library, no context provider, no animation, no CSS. Keep files under ~250 lines.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-07-rejoin-banners`. Make atomic conventional commits:
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first, then the implementation. Paste the red excerpt and the full green output of every gate in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-07 path and rejoin banners`, with this body:

```
Ticket: DT-07 (docs/TDD_TICKETS.md §5) · Acceptance: P14 (no flicker under 10 s, holding then clear, SDK-only lost, denial overrides, stale tunnel ignored), transport switch

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<full green output of every gate>
<tauri dev manual check: 5 s and 30 s Wi-Fi toggles, or "no phone available">

## Out of scope (left for later tickets)
- end-state screens and Reconnect (DT-16), devices list (DT-08), tray (DT-09), T−5 warning (P13, gated)
```

Then **stop immediately**. Don't start DT-08, don't edit `docs/`, and don't merge.
