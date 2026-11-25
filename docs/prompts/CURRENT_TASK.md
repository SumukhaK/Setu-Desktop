# Builder prompt · DT-12 · Settings: computer name, relay, pin, proxy

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-14).
2. `docs/TDD_TICKETS.md` §5 "DT-12" (including its 2026-11-25 note) and §3 row P16.
3. `docs/JOURNEYS.md` J6 "Diagnostics" paragraph (the Settings sentences) and row P16; `docs/SCREENS.md` row D10.
4. Setu-SDK v1.1.0 `API_SPEC.md` §2, the daemon start flags: https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
5. The prototype (visual reference only, never app code):
   - `prototype.js`: `settingsPage()`, the `case 'settings'` submit handler, `parseUrl()`, `validRelay()`, and the `settings` icon path in the icon table at the top
   - `styles.css`: `form > label`, `input:not([type="checkbox"])`, `input::placeholder`, `input[aria-invalid="true"]`, `.error-message`, `.button-row`, `.standard-card .button-row`
6. Existing code you'll use or extend:
   - `src-tauri/src/daemon/config.rs` (`DaemonConfig`, `to_args`), `src-tauri/src/daemon/supervisor.rs`
   - `src-tauri/src/store/nicknames.rs` (the atomic-JSON pattern to copy)
   - `src-tauri/src/commands/quit.rs` (`end_all_sessions`)
   - `src-tauri/src/app/mod.rs` (`setup`, `computer_name()`), `src-tauri/src/app/status.rs` (`resolve_relay`)
   - `src-tauri/tests/daemon_supervisor.rs` and `tests/support/fake_setu_daemon.rs` (`FAKE_DAEMON_ARGS_FILE`)
   - `src/app/Shell.tsx`, `src/app/Icon.tsx`, `src/app/QuitConfirm.tsx` (the dialog pattern), `src/App.tsx`, `src/platform/tauri.ts`, `src/main.tsx`, `src/styles/app.css`

**Facts this ticket relies on (read by the reviewer in the v1.1.0 source, `core/internal/daemon/cmd.go` and `core/internal/engine/transport.go`):**
- The daemon takes `--label`, `--relay`, `--relay-pin` and `--proxy` at start only. There is no RPC to change them, so applying new values means restarting the daemon.
- `--relay` accepts `host:port`, `ws://…` or `wss://…`.
- `--relay-pin` is compared, after removing `:` and lower-casing, with the hex SHA-256 of the relay's leaf certificate DER. The daemon does not check its length; a wrong pin only shows up as a failed TLS connection. It only matters for `wss://`.
- `--proxy` is parsed with Go's `url.Parse` and used as an HTTP CONNECT proxy for ws/wss. Empty means "use `HTTPS_PROXY`/`HTTP_PROXY`".
- v1.1.0 has no shutdown RPC. The app can only restart a daemon **it spawned**. An attached daemon (`DaemonState::Ready { attached: true }`) can't be restarted from here.

## 1. Goal

A **Settings** page in the rail (D10, P16) edits four daemon start values: **Computer name**, **Custom relay URL**, **Relay certificate pin** and **Corporate HTTP proxy**.
- Rust validates and saves them in a desktop-only JSON file.
- **Apply** restarts only the Solo daemon this app spawned, after a confirmation that names the live sessions it will end.
- It never silently switches transport. If the new values fail, the daemon shows Restarting or Failed with those values, and the app never falls back to the old ones.

Out of scope:
- `--relay-ca` (needs a file picker).
- Proxy user names or passwords. The proxy field rejects them, as the prototype does, so no credential is ever stored or sent back to the page.
- Corporate workspaces (DT-14+).
- The audit log (DT-13).
- The UK-05 nits.
- Any change to Diagnostics.

## 2. Files (create or change only these)

```
src-tauri/src/store/settings.rs            ConnectionSettings, SettingsStore (atomic JSON)
src-tauri/src/store/mod.rs                 pub mod settings;
src-tauri/src/commands/settings.rs         SettingsInput, Invalid, validate(), build_config(), SettingsView, ApplyOutcome, apply_settings()
src-tauri/src/commands/mod.rs              pub mod settings; re-exports
src-tauri/src/daemon/supervisor.rs         + Supervisor::restart_with(config) -> RestartOutcome
src-tauri/src/daemon/mod.rs                re-export RestartOutcome
src-tauri/tests/settings_commands.rs       validation, store, build_config, apply (§4)
src-tauri/tests/daemon_supervisor.rs       + restart_with tests (§4)
src-tauri/src/app/mod.rs                   startup reads settings; + commands settings_get, settings_apply
src/features/settings/settingsPort.ts      TS mirrors, SettingsPort
src/features/settings/settingsText.ts      fieldError() messages, outcomeText() (+ .test.ts)
src/features/settings/SettingsPage.tsx     form, confirm dialog, outcomes (+ .test.tsx)
src/app/Icon.tsx                           + "settings" icon (prototype path)
src/app/Shell.tsx (+ Shell.test.tsx)       Page += "settings" (icon "settings", label "Settings")
src/App.tsx, src/App.test.tsx              optional settingsPort, + rail item and page
src/platform/tauri.ts                      + tauriSettingsPort
src/main.tsx                               pass settingsPort
src/styles/app.css                         port the rules listed in §0 step 5 that app.css doesn't have yet
```

Don't touch:
- `rpc/`, `events/`, `adb/` or `log/`
- `daemon/config.rs`: its argv order is already right
- `daemon/workspace.rs`, `ready_line.rs`
- `store/nicknames.rs`, or the other `commands/*`
- `capabilities/`, `tauri.conf.json`
- `src/state/`, or the other feature folders
- `docs/`, `README.md`, the prototype, or CI

Add no crate and no npm package.

## 3. Contract to implement (decided by the architect; do not reinterpret)

**Stored settings (`store/settings.rs`).**

```rust
#[derive(Clone, PartialEq, Default)]          // no Debug (AD-5 habit for config types)
pub struct ConnectionSettings {
    pub label: Option<String>,
    pub relay: Option<String>,
    pub relay_pin: Option<String>,   // normalized: 64 lower-case hex, no colons
    pub proxy: Option<String>,
}
pub struct SettingsStore { /* path, lock */ }
impl SettingsStore {
    pub fn new(state_dir: &Path) -> Self;               // <state_dir>/desktop-settings.json
    pub fn load(&self) -> ConnectionSettings;            // missing, malformed, wrong version, or any value that fails validate() → Default
    pub fn save(&self, settings: &ConnectionSettings) -> io::Result<()>;  // atomic: temp file + rename, like NicknameStore
}
```

File shape: `{"version":1,"label":…,"relay":…,"relay_pin":…,"proxy":…}`, where an absent value is `null`.

**Validation (`commands/settings.rs`).** It's the only validator. The page shows Rust's verdict and doesn't re-implement the rules.

```rust
#[derive(Deserialize)]
pub struct SettingsInput { pub label: String, pub relay: String, pub relay_pin: String, pub proxy: String }

#[derive(Clone, Copy, Serialize, PartialEq, Debug)] #[serde(rename_all = "snake_case")]
pub enum SettingsField { Label, Relay, RelayPin, Proxy }
#[derive(Clone, Copy, Serialize, PartialEq, Debug)] #[serde(rename_all = "snake_case")]
pub enum Problem { Format, TooLong, NeedsWss, HasCredentials }
#[derive(Clone, Copy, Serialize, PartialEq, Debug)]
pub struct Invalid { pub field: SettingsField, pub problem: Problem }

pub fn validate(input: &SettingsInput, fallback_relay: Option<&str>) -> Result<ConnectionSettings, Invalid>;
```

Trim every field first. An empty field becomes `None`. Then check the fields in this order, and return the first failure:

1. **label:**
   - more than 64 `char`s → `TooLong`
   - any `char::is_control` → `Format`
2. **relay:**
   - any whitespace inside → `Format`
   - If it contains `://`:
     - the scheme, compared without case, must be `ws` or `wss`, else `Format`
     - the authority is everything up to the first `/`, `?` or `#`
     - an authority containing `@` → `HasCredentials`
     - an empty authority → `Format`
   - Otherwise it must be `host:port`, else `Format`:
     - host is `[A-Za-z0-9.-]+`, or `[` + `[0-9A-Fa-f:.]+` + `]`
     - port is 1 to 65535, digits only
3. **relay_pin:**
   - remove every `:`; the rest must be exactly 64 ASCII hex digits, else `Format`
   - store it lower-cased, without colons
   - Then, if a pin is set and the **effective relay** (the new relay, else `fallback_relay`) doesn't start with `wss://` (compared without case) → `NeedsWss`
4. **proxy:**
   - must start with `http://` or `https://` (compared without case), else `Format`
   - the authority is everything up to the first `/`
   - an authority containing `@` → `HasCredentials`
   - otherwise it must be `host:port` as above, else `Format`
   - anything after the authority other than nothing or a single `/` → `Format`

All four rules are hand-scanned. Don't add a regex or URL crate.

**Effective config.**

```rust
pub fn build_config(daemon_path: PathBuf, fallback_relay: Option<String>, settings: &ConnectionSettings, computer_name: Option<String>) -> Option<DaemonConfig>;
```

- `relay` = `settings.relay`, else `fallback_relay`. If both are `None`, return `None`.
- `label` = `settings.label`, else `computer_name`.
- `relay_pin` and `proxy` come from `settings`. `adb_path` and `corporate` are `None`.

**Page view.**

```rust
#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct SettingsView { pub label: String, pub relay: String, pub relay_pin: String, pub proxy: String,
                          pub default_label: Option<String>, pub default_relay: Option<String> }
pub fn settings_view(settings: &ConnectionSettings, fallback_relay: Option<&str>, computer_name: Option<&str>) -> SettingsView;
```

- `None` values show as `""`.
- `default_relay` is `fallback_relay` passed through `redact()`.
- `default_label` is the computer name.

**Supervisor.**

```rust
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum RestartOutcome { Restarting, NotOwned }
impl Supervisor { pub async fn restart_with(&self, config: DaemonConfig) -> RestartOutcome; }
```

- If the current state is `Ready { attached: true, .. }`, return `NotOwned` and change nothing.
- If the run task is still alive:
  - Tell it, through the existing control channel (turn `mpsc::Sender<()>` into a small enum, `Stop | Restart(Box<DaemonConfig>)`), to kill and reap the child it spawned and remove the attach record it owns.
  - Then publish `Starting` and start again with the new config, with the failure count reset.
  - A restart that arrives during the backoff sleep applies at once.
- If the run task has ended (`Failed` or `Stopped`), start a fresh run task on the **same** watch sender, so existing subscribers and the event hub keep working.
- Return `Restarting` once the request has been handed over. Don't wait for `Ready`.
- `generation` never repeats within one `Supervisor`. Keep the next generation in the shared struct, not as a local in `run`.
- `stop()` and the P17 rules are unchanged: a dropped handle never kills the daemon.

**Apply.**

```rust
#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ApplyOutcome { Applied, SavedForNextStart, SavedNotOwned, Invalid { field: SettingsField, problem: Problem }, SaveFailed }

pub async fn apply_settings(store: &SettingsStore, supervisor: Option<&Supervisor>, input: &SettingsInput,
                            fallback_relay: Option<String>, daemon_path: PathBuf, computer_name: Option<String>) -> ApplyOutcome;
```

1. `validate` → on error, `Invalid`. Nothing is saved.
2. `store.save` → on error, `SaveFailed`.
3. If there's no supervisor, or `build_config` returns `None` → `SavedForNextStart`.
4. If the supervisor is `Ready { attached: true }` → `SavedNotOwned`. No session is ended.
5. Otherwise call `end_all_sessions` with the current ready client (or `None`), under a 5 s timeout, ignoring its outcome. Then call `restart_with(config)`:
   - `Restarting` → `Applied`
   - `NotOwned` → `SavedNotOwned`

**Shell (`app/mod.rs`).**

- At startup, load the `SettingsStore` for the Solo state dir. Then build the supervisor config with `build_config(daemon_path, resolve_relay(env, compile-time), &settings, computer_name())`.
  - `None` → `NotConfigured`, no supervisor, as today.
- Keep `daemon_path`, `fallback_relay` and the store in `AppState`.
- Add `#[tauri::command] fn settings_get(..) -> SettingsView`.
- Add `#[tauri::command] async fn settings_apply(input: SettingsInput, ..) -> Result<ApplyOutcome, String>`.
- No other shell change.

**UI.**

- `settingsPort.ts`:
  - Mirror `SettingsView` (snake_case fields), `SettingsInput` `{ label, relay, relay_pin, proxy }` and `ApplyOutcome`, with `field`/`problem` as string unions.
  - `SettingsPort { get(): Promise<SettingsView>; apply(input: SettingsInput): Promise<ApplyOutcome> }`.
  - `tauriSettingsPort.apply` calls `invoke("settings_apply", { input })`.
- `settingsText.ts`:
  - `fieldError(field, problem)` returns:
    - label + too_long → "Use 64 characters or fewer."
    - label + format → "Remove control characters from the name."
    - relay + format → "Enter a wss:// or ws:// relay URL, or a TCP host:port."
    - relay + has_credentials → "Remove the user name and password from the relay URL."
    - relay_pin + format → "Enter 64 hexadecimal digits, with optional colons."
    - relay_pin + needs_wss → "A certificate pin needs a wss:// relay."
    - proxy + format → "Enter an HTTP proxy URL like http://proxy.example.test:8080."
    - proxy + has_credentials → "Enter the proxy without a user name or password."
    - any other pair → "Check this value."
  - `outcomeText(outcome)` returns:
    - applied → "Settings applied. The Setu service is restarting."
    - saved_for_next_start → "Settings saved. They apply the next time Setu starts."
    - saved_not_owned → "Settings saved. Setu is using a service it didn't start, so quit Setu and open it again to apply them."
    - save_failed → "Couldn't save settings. Try again."
- `SettingsPage` (props `{ port: SettingsPort; liveDeviceIds: string[] }`):
  - **Heading:** `<header className="page-heading">` with `<h1 tabIndex={-1}>Settings</h1>` and the subtitle "Local service startup configuration".
  - **Loading:** on mount, `port.get()` fills the form. While loading, show `<p className="notice" role="status">Loading settings…</p>`. If it's rejected, show `<p className="notice warning" role="alert">Couldn't reach the Setu service. Try again.</p>` with a **Try again** button.
  - **Form:** one `<section className="card standard-card">` with `<h2>Relay and proxy</h2>` and a `<form noValidate>` holding four labelled inputs. Use the prototype's ids, labels, hints, `maxLength={64}` on the name, and `spellCheck={false}` on the pin.
    - Placeholders:
      - name: `default_label ?? ""`
      - relay: `default_relay ?? "wss://relay.example.test"`
      - proxy: `"http://proxy.example.test:8080"`
    - Hint changes from the prototype:
      - The relay hint gets " Leave empty to use the built-in relay." when `default_relay` is set.
      - The proxy hint reads "HTTP CONNECT proxy for ws and wss relays. Leave empty to use HTTPS_PROXY. User names and passwords aren't supported."
  - **Apply** (`button primary`, label "Apply and restart"):
    - If `liveDeviceIds` is empty, call `port.apply` right away.
    - Otherwise, open an `alertdialog` in the `QuitConfirm` pattern (focus on Cancel, Escape cancels):
      - title "Restart the Setu service?"
      - body "{N} live session(s) will end:" followed by a `<ul>` of the device ids
      - buttons **Restart and apply** (`button primary danger`) and **Cancel**
  - **While applying:** the button is disabled and reads "Applying…".
  - **Outcomes:**
    - `invalid` → `aria-invalid="true"` on that field only. Show its `fieldError` in `<p id="setting-error" className="error-message" role="alert">`, and point that input's `aria-describedby` at it. Then move focus to that input.
    - Any other outcome → its `outcomeText` in `<p role="status">` (`save_failed` goes in a `role="alert"` warning notice instead). Clear any field error.
    - A rejected `apply` → "Couldn't reach the Setu service. Try again." as an alert.
  - **Late results:** a result that arrives after unmount is ignored (the DiagnosticsPage `sequence` pattern).
- `Icon`: add `settings` with the prototype's path.
- `Shell`: `Page` gains `"settings"`, with `navItems.settings = { label: "Settings", icon: "settings" }`.
- `App`:
  - optional `settingsPort`
  - add `"settings"` to `items` after Diagnostics when the port is given
  - render `SettingsPage` with `liveDeviceIds={live.map((s) => s.deviceId)}`
  - `main.tsx` passes `tauriSettingsPort`
- CSS: port the listed prototype rules verbatim, apart from formatting. No inline styles.

## 4. TDD: write these tests first, see them fail, then implement

In Rust tests, build any URL with a user and password from parts (`format!("http://{}:{}@proxy.corp:3128", "alice", "pw")`). In TS, use `["http://", "alice", ":", "pw", "@proxy.corp:3128"].join("")`. That keeps secret scanners on the PR quiet.

- **`tests/settings_commands.rs`:**
  - **validate, as a table:**
    - all empty → all `None`
    - name of 64 chars OK, 65 → `TooLong`; a `\u{7}` → `Format`
    - relay values accepted:
      - `wss://relay.example.test`
      - `WS://10.0.0.5:7000/x`
      - `relay.example.test:443`
      - `[::1]:7000`
    - relay values rejected:
      - `ftp://x` → `Format`
      - `wss://` → `Format`
      - `relay:0` → `Format`
      - `relay:65536` → `Format`
      - `relay` → `Format`
      - `wss://a b` → `Format`
      - a credentialed `wss://` URL → `HasCredentials`
    - pins:
      - 64 hex digits with and without colons are both stored as the same lower-case value
      - 63 digits → `Format`
      - a `g` → `Format`
      - a valid pin with relay `ws://…` → `NeedsWss`
      - a valid pin with an empty relay and fallback `wss://…` → OK
      - a valid pin with an empty relay and fallback `relay:7000` → `NeedsWss`
    - proxies:
      - `http://proxy.example.test:8080` and `https://p:3128/` are OK
      - `socks5://p:1` → `Format`
      - `http://p` (no port) → `Format`
      - `http://p:8080/path` → `Format`
      - a credentialed proxy → `HasCredentials`
    - with two bad fields, the first in rule order is reported
  - **build_config:**
    - the settings relay overrides the fallback
    - no relay anywhere → `None`
    - an empty label falls back to the computer name
    - `to_args` of the result has `--relay-pin <normalized>` and `--proxy <value>`
  - **SettingsStore:**
    - save then load round-trips
    - a missing file, malformed JSON, `version: 2`, or a stored proxy with credentials each load as `Default`
    - no `.tmp` file is left behind
  - **apply_settings:**
    - `Invalid` saves nothing (the file doesn't exist)
    - no supervisor → `SavedForNextStart`, and the file is written
    - with a supervisor running `fake-setu-daemon` → `Applied`; the next `Ready` has a higher generation and a new pid, and the second argv line holds the new `--label` and `--relay-pin`
    - an attached supervisor → `SavedNotOwned`; the attached daemon's pid is still alive, and its generation is unchanged
- **`tests/daemon_supervisor.rs`:**
  - `restart_with` on a spawned daemon kills the old pid, and the record holds the new pid
  - a supervisor whose first config points at a missing daemon path reaches `Failed`; then `restart_with` a valid config reaches `Ready` on the same receiver
  - generation keeps increasing across both
  - every wait is under `timeout`
- **`settingsText.test.ts`:** every `fieldError` pair, the fallback, and every `outcomeText` branch.
- **`SettingsPage.test.tsx`:**
  - loading → the form is filled from `get()`, and the placeholders use the defaults
  - with no live sessions, Apply calls `apply` once with the trimmed-as-typed values (Rust trims; the page sends what's typed)
  - with two live sessions, the dialog lists both ids; Cancel calls nothing; **Restart and apply** calls `apply` once
  - `invalid` marks only that field, focuses it, and shows its message
  - each outcome shows its text
  - a rejected `get`, then **Try again**, loads the form
  - a late result after unmount doesn't throw or update
- **`Shell.test.tsx` / `App.test.tsx`:** the Settings rail item appears only with a `settingsPort`, after Diagnostics. Clicking it focuses the "Settings" `h1` and calls `get` once.

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

All three CI jobs (`gates-linux`, `gates-windows`, `e2e-linux`) must be green on the PR head.

Don't use any of these:
- `#[allow(...)]`
- `unwrap()` outside tests
- `eslint-disable`
- `@ts-ignore` or `@ts-expect-error`
- `any`
- non-null `!`
- inline styles

**Manual check** (name the OS): run `npm run tauri dev` with a real daemon and a relay, and pair a phone.
1. Change the Computer name and apply through the confirm dialog. Show that the session ended, the status strip went Starting → Ready, and the phone shows the new name on the next connect.
2. Enter a wrong 64-digit pin with a `wss://` relay and apply. Show that the status goes to Restarting/Failed and stays on that relay (no silent fallback).
3. Clear the pin and apply. Show that it recovers.

Attach screenshots of each step.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** Rust owns validation, the file, the session ending and the restart. The page lays out values and messages and never decides validity (AD-1, AD-9).
- **AD-5.** No credential can be stored, because the proxy and relay reject userinfo. `ConnectionSettings` and `SettingsInput` don't derive `Debug`.
- **P17 stays intact.** `restart_with` kills only a child this supervisor spawned; dropping a handle still never kills the daemon.

1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. It must cover:
   - why the attached case is saved, not applied
   - what a stuck `end_all_sessions` does to Apply
   - why rejecting proxy credentials is acceptable for now
2. **Simplicity first.** One file, one validator, one new supervisor method. No live validation while typing, no "test connection" button, no CA file.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-12-settings`, with atomic commits:
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first. Paste into the PR:
   - the red excerpt
   - the green gate output
   - the CI links
   - the manual check

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-12 settings`, with this body:

```
Ticket: DT-12 (docs/TDD_TICKETS.md §5) · Acceptance: P16 (pin validated as 64 hex with optional colons; applying restarts only that workspace's daemon after naming the sessions it will end; never silently switches transport) · SCREENS D10

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<green gate output>
<CI run links>
<manual check: screenshots for name change, wrong pin, recovery>

## Out of scope (left for later tickets)
- --relay-ca, proxy credentials, corporate workspaces, audit log (DT-13), UK-05 nits
```

Then **stop immediately**. Don't start DT-13 or UK-05, don't edit `docs/`, and don't merge.
