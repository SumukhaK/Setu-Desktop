# Builder prompt · UK-02 · App shell: navigation rail, pages and styling

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-14).
2. `docs/TDD_TICKETS.md` §5a "UK-02".
3. `docs/SCREENS.md`: the layout block at the top ("Relay sidebar and workspace cards with the Signal status strip"), and rows D03 and D04.
4. The prototype, which is the **visual reference only, never app code**:
   - `index.html`: the chrome header.
   - `styles.css`: the tokens in `:root`, plus `.chrome`, `.wordmark`, `.brand-mark`, `.shell`, `.rail`, `.workspace-picker`, `.rail-nav`, `.nav-link`, `.main-pane`, `.main-inner`, `.app-status`, `.page-heading`, `.button*`, `.card`, `.section-header`, `.session-card`, `.status*`, `.signal-strip`, `.notice*`, `.list*`, `dialog`, `.dialog-*`, and the `@media` rules for those.
   - `prototype.js`: `icons`, `railButton`, `render`, `workspacePage`, `sessionCard`, `signalStrip`, `devicesPage`.
5. Existing UI you'll restyle without changing behaviour:
   - `src/App.tsx`
   - `src/daemon/StatusStrip.tsx`
   - `src/features/session/*` (`SessionCard`, `StatusStrip`, `RejoinBanner`)
   - `src/features/adb/SessionAdbLine.tsx`
   - `src/features/pair/PairDialog.tsx`
   - `src/features/devices/*`
6. `src-tauri/tauri.conf.json` (`app.security.csp`).

**Fact this ticket relies on:** Vite emits imported CSS as a linked stylesheet in `npm run build`, which the production CSP `style-src 'self'` allows. In `vite dev` it injects `<style>` tags, which that CSP blocks. Tauri v2 has a separate `app.security.devCsp` for dev builds.

## 1. Goal

The app gets the selected layout: a top chrome bar with the wordmark, a left rail and a main pane. The rail has the workspace label at the top and navigation below it. The main pane has a page heading, the page content and the footer `Setu-SDK v1.1.0`.

There are two pages:
- **Workspace:** the daemon status strip, the session cards and **Pair new device**.
- **Devices:** the DT-08 Saved devices list.

Existing components get the prototype's look through class names and one stylesheet. **Behaviour, copy, roles and labels don't change**, so every existing test keeps passing unedited, except the few App tests that must click into Devices first.

Out of scope:
- The workspace switcher (the D01 Corporate entry). The picker is a static label, "Solo" over "Solo mode", until DT-14.
- The topology diagram.
- Tray (DT-09).
- Pages for Audit log, Diagnostics and Settings. Each later ticket adds its own rail item.
- Toasts.
- Dark mode.

## 2. Files (create or change only these)

```
src/styles/app.css                    tokens + the ported rules in §3 (≤ ~350 lines)
src/app/Icon.tsx                      <Icon name size> rendering the prototype's SVG paths for: grid, phone, laptop, plus, link, unlink, terminal, monitor
src/app/Shell.tsx                     chrome + rail + main pane + footer; props { page, onNavigate, children }
src/app/Shell.test.tsx
src/app/WorkspacePage.tsx             what App renders today minus DeviceList, under heading "Workspace"
src/app/DevicesPage.tsx               DeviceList under heading "Devices"
src/App.tsx, src/App.test.tsx         page state; hooks stay in App
src/main.tsx                          import "./styles/app.css" once
src/index.html                        <html lang="en">, <meta name="color-scheme" content="light">; nothing else
src/daemon/StatusStrip.tsx            className only
src/features/session/SessionCard.tsx, StatusStrip.tsx, RejoinBanner.tsx   className only
src/features/adb/SessionAdbLine.tsx    className only
src/features/pair/PairDialog.tsx       className only
src/features/devices/DeviceList.tsx, DeviceDetail.tsx                       className only
src-tauri/tauri.conf.json              + app.security.devCsp (§3)
```

"className only" means you may add `className` attributes and wrapping `<div>`s with no role. You must not change text, roles, `aria-*`, handlers, element order, or the element types that tests query. Don't touch `src-tauri/src/`, `src/state/`, `src/platform/`, any `*Port.ts`, `docs/`, `README.md`, the root prototype files, or CI. Add no npm package (no router, CSS framework or icon library).

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Page state (App).**
- `type Page = "workspace" | "devices"`, held in `useState<Page>("workspace")` in `App`.
- `useSessions`, `useAdbStatus` and the pairing-dialog open state stay in `App`, above both pages, so switching pages never resubscribes or drops a session.
- The Devices rail item renders only when `devicesPort` is given.
- No URL routing, no hash and no history.

**Shell.**
- `<header className="chrome">`: the wordmark `<span className="wordmark">` (brand mark, "setu" and a period), not a link. The demo-scenarios button is not ported.
- `<div className="shell">` containing:
  - `<aside className="rail">`, which holds:
    - a static `<div className="workspace-picker">` with the laptop glyph, `<strong>Solo</strong>` and `<small>Solo mode</small>`, with no button role
    - `<nav aria-label="Workspace navigation" className="rail-nav">` with a `<button className="nav-link">` per page (icon + label: grid "Workspace", phone "Devices"). The current page's button has `aria-current="page"` and the `active` class.
  - `<main id="main" className="main-pane" tabIndex={-1}>` containing `<div className="main-inner">{children}</div>` and `<footer className="app-status">Setu-SDK v1.1.0</footer>`.
- On navigation, move focus to the new page's `<h1>` (`tabIndex={-1}`), as the prototype does.

**Pages.**
- Each page opens with `<header className="page-heading"><div><h1 tabIndex={-1}>…</h1><p>…</p></div></header>`:
  - Workspace: subtitle "This computer · Solo · Local-first".
  - Devices: subtitle "Paired phones on this computer".
- Today's App heading `<h1>Setu</h1>` moves into the chrome as the wordmark. Each page's `<h1>` is its title.
- Workspace renders, in today's order:
  1. the daemon `StatusStrip`
  2. the session count line
  3. the `SessionCard`s (each in `className="card session-card"`)
  4. **Pair new device** (`button primary`)
  5. `PairDialog`

**Styles (`app.css`).**
- Copy the `:root` tokens **verbatim**, plus the base rules (`*`, `body`, buttons, focus-visible, `h1`–`h3`, `code`).
- Port only the selectors listed in §0.4 that a rendered component uses.
- Map them onto existing elements:

  | Element | Class |
  | --- | --- |
  | session StatusStrip `<ul aria-label="Session status">` | `signal-strip` (three cells) |
  | each fact | `<li>` cell |
  | daemon strip | `notice` |
  | RejoinBanner holding | `notice warning` |
  | RejoinBanner lost | `notice warning` |
  | alerts | `notice` |
  | buttons | `button` plus `primary`, `secondary` or `quiet` |
  | Disconnect | `button quiet danger` |
  | device rows | `list` / `list-row` |
  | DeviceDetail | `card` |

- The `.signal-strip` grid uses three columns, not the prototype's four.
- **No inline `style={…}` anywhere**, because the production CSP forbids style attributes. No `!important` except the prototype's `[hidden]` rule.

**CSP.**
- Keep `app.security.csp` exactly as it is.
- Add `"devCsp": "default-src 'self'; connect-src ipc: http://ipc.localhost ws://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self'"`.
- Add a Rust-free check: a Vitest test that reads `src-tauri/tauri.conf.json` and asserts that `csp` contains `style-src 'self'` and not `unsafe-inline`.

## 4. TDD: write these tests first, see them fail, then implement

- `Shell.test.tsx`:
  - It renders the chrome wordmark, the Workspace navigation landmark, the "Solo mode" label and the footer `Setu-SDK v1.1.0`.
  - Only the items passed in render; with no `devicesPort`, there's no Devices button.
  - The current item has `aria-current="page"`. Clicking another item calls `onNavigate` with its page.
- `App.test.tsx`:
  - The default page is Workspace, and its `h1` is "Workspace".
  - Clicking **Devices** shows the Saved devices section, focuses the "Devices" `h1`, and hides the session cards.
  - Going back to Workspace still shows the live session card. It stays live even when a hub event arrives while on Devices.
  - The fake hub `subscribe` was called **once** across both switches.
  - The pairing dialog opened on Workspace is still open after Devices and back again.
  - Update the existing App tests that look for the device list so they click **Devices** first. No other existing test may change.
- CSP test as in §3.
- **Visual evidence:** attach to the PR two screenshots from `npm run tauri dev` (Workspace with a session if you can pair a phone, otherwise empty; and Devices), and one from `npm run build && npx vite preview` with the devtools console showing no CSP errors.

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

All three CI jobs (`gates-linux`, `gates-windows`, `e2e-linux`) must be green on the PR head. Use no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no non-null `!`, and no inline styles. If a gate fails for a reason you can't fix in code, stop and report the exact error.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** No native change apart from `devCsp`. Pages compose the existing feature components, and the features keep owning their behaviour.
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. List every prototype selector you did **not** port, and why.
2. **Simplicity first.** One stylesheet, one icon component, one shell, two pages. No router, no CSS modules, no theme provider, no animation.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `upkeep/UK-02-app-shell`, with atomic commits:
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first. Paste the red excerpt and the green gate output in the PR, plus the CI links and the screenshots.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): UK-02 app shell, navigation and styling`, with this body:

```
Ticket: UK-02 (docs/TDD_TICKETS.md §5a) · Reference: SCREENS.md layout, D03, D04; prototype styles.css

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<green gate output>
<CI run links>
<screenshots: Workspace, Devices, production preview console>

## Out of scope (left for later tickets)
- workspace switcher (DT-14), topology diagram, tray (DT-09), Audit/Diagnostics/Settings pages (DT-11..DT-13), Solo end states (UK-03)
```

Then **stop immediately**. Don't start UK-03, don't edit `docs/`, and don't merge.
