# Builder prompt · DT-08 · Devices list, forget and nicknames (Solo)

You are the builder for one ticket in `SumukhaK/Setu-Desktop`. Do this ticket only, open one PR, then stop.

## 0. Read first (in this order, nothing else)

1. `docs/CODEBASE_MEMORY.md` (interfaces, AD-1 to AD-13). This ticket adds AD-14 (§3, nickname store). The reviewer records it in memory after merge.
2. `docs/TDD_TICKETS.md` §4 (stack) and §5 "DT-08". **One architect override:** the ticket says SQLite, but use the atomic JSON file in §3 instead.
3. `docs/JOURNEYS.md`: J3.1 step 1 (the Solo half), the "Forget device" bullet in J4, and rows P08 (Solo part) and P17 (the **forget** part).
4. `docs/SCREENS.md` row D03 (the Solo half).
5. Setu-SDK v1.1.0 `API_SPEC.md` §2.1 (`devices.list`, `devices.forget`, `session.connect {device_id}`, `session.cancel`) and §2.3 (`-32011`, `-32012`, `-32014`): https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md
6. Existing code you'll use:
   - `src-tauri/src/commands/session.rs`: `PendingConnect`, `SlotGuard`, `connect_with_code`, `ConnectOutcome`.
   - `src-tauri/src/daemon/workspace.rs`: `write_attach_record` is the atomic-write pattern to copy.
   - `src-tauri/src/app/mod.rs`, `src/features/pair/pairPort.ts`, `src/platform/tauri.ts`, `src/App.tsx`.

**SDK facts this ticket relies on (verified against `core/` at v1.1.0):**
- `devices.list` returns `{devices: [{id, paired, source}]}`. In Solo, `source` is `"state"` (local pins). The daemon always sends `[]`, never null.
- `devices.forget {device_id}` deletes the local pin. On success daemon v1.1.0 replies `result: {}` (checked against a live daemon on 2026-11-22). Treat any `Ok`, including a missing `result` (`RpcClient::call` maps that to `Value::Null`), as forgotten. An unknown id returns `-32012` (`SetuError::NotPaired`). Forget never touches the phone.
- `session.connect {device_id, timeout_ms}` reconnects a pinned device. Errors you must type: `-32011` unavailable (phone offline), `-32012` not paired, `-32014` revoked, `-32022` cancelled.
- Device ids are opaque strings (the daemon base64-encodes them for its file names). Never normalise, trim or case-fold an id. A nickname is a local label only.

## 1. Goal

Solo users see their paired phones in a **Saved devices** list from `devices.list`. Each row shows the exact `device_id` and an optional local nickname. Presence is always "Presence unknown" in Solo; there is no online dot.

Selecting a row opens its detail, which offers four actions:
- **Rename** edits the local nickname. It never changes the id or the pin.
- **Connect** runs `session.connect {device_id}`, with Cancel while it's pending.
- **Forget** runs `devices.forget`, after an inline confirmation that says it does not revoke access on the phone.
- When the device already has a live session, the detail shows "Connected" instead of Connect.

Out of scope: corporate presence (DT-15), tray (DT-09), routing, CSS and the prototype.

## 2. Files (create or change only these)

```
src-tauri/src/store/mod.rs                pub mod nicknames;
src-tauri/src/store/nicknames.rs          NicknameStore (§3) + unit tests (tempfile)
src-tauri/src/lib.rs                      + pub mod store;
src-tauri/src/commands/devices.rs         DeviceRow, ListOutcome, ForgetOutcome, NicknameOutcome, list_devices, forget_device, set_nickname, valid_device_id
src-tauri/src/commands/mod.rs             + pub mod devices; re-exports
src-tauri/src/commands/session.rs         + connect_with_device; ConnectOutcome + NotPaired, Revoked; SlotGuard fix (§3)
src-tauri/tests/device_commands.rs        new (FakeDaemon)
src-tauri/tests/session_commands.rs       + device-connect tests
src-tauri/src/app/mod.rs                  inside `mod shell`: AppState gains `nicknames: NicknameStore`; + 4 commands
src/features/devices/devicesPort.ts       DevicesPort, outcome mirrors, message functions
src/features/devices/DeviceList.tsx       list + selection
src/features/devices/DeviceDetail.tsx     id, nickname editor, Connect/Cancel, Forget with inline confirm
src/features/devices/*.test.tsx|ts        tests in §4
src/features/pair/pairPort.ts (+ test)    mirror the two new ConnectOutcome variants and their copy
src/platform/tauri.ts                     + tauriDevicesPort (still the only @tauri-apps/api import)
src/App.tsx, src/main.tsx, src/App.test.tsx   render <DeviceList> under the session cards
```

Don't change `rpc/`, `daemon/`, `adb/`, `events/`, `src/state/*`, `src/features/session/*`, `src/features/adb/*`, `PairDialog.tsx`, `docs/`, `README.md` or the prototype. Add no crate and no npm package (`tempfile` is already a dev-dependency).

## 3. Contract to implement (decided by the architect; do not reinterpret)

**AD-14 · Nickname store (`store/nicknames.rs`).** Nicknames live in the desktop app, never in the daemon. They are stored per workspace in `<state_dir>/desktop-nicknames.json` as `{"version":1,"nicknames":{"<exact device_id>":"<nickname>"}}`.

```rust
pub struct NicknameStore { path: PathBuf, lock: Mutex<()> }
impl NicknameStore {
    pub fn new(state_dir: &Path) -> Self;
    pub fn load(&self) -> BTreeMap<String, String>;                  // missing, unreadable or corrupt file → empty map
    pub fn set(&self, device_id: &str, nickname: Option<&str>) -> std::io::Result<()>; // None removes
}
pub fn normalize_nickname(raw: &str) -> Result<Option<String>, ()>; // trim; "" → Ok(None); 1–40 chars; no control chars
```

- `set` holds `lock`, reloads the file, applies the change, then writes atomically: create the dir if needed, write `desktop-nicknames.json.tmp`, `sync_all`, then rename. Copy `write_attach_record`.
- Keys are byte-exact. `"Pixel-7"` and `"pixel-7"` are different devices.
- A corrupt file loads as empty, and the next successful `set` rewrites it. Don't panic, and don't log contents.

**Device commands (`commands/devices.rs`).**

```rust
#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct DeviceRow { pub device_id: String, pub paired: bool, pub source: String, pub nickname: Option<String> }

#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ListOutcome { Listed { devices: Vec<DeviceRow> }, NotReady, Failed { code: Option<i64> } }
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ForgetOutcome { Forgotten, NotPaired, NotReady, Invalid, Failed { code: Option<i64> } }
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum NicknameOutcome { Saved { nickname: Option<String> }, Invalid, Failed }

pub fn valid_device_id(id: &str) -> bool;  // 1–256 bytes, no control characters; nothing else is changed or checked
pub async fn list_devices(client: Option<RpcClient>, store: &NicknameStore) -> ListOutcome;
pub async fn forget_device(client: Option<RpcClient>, device_id: &str, store: &NicknameStore) -> ForgetOutcome;
pub fn set_nickname(store: &NicknameStore, device_id: &str, raw: &str) -> NicknameOutcome;
```

- `list_devices`:
  - No client → `NotReady`.
  - Call `devices.list` and parse `{devices:[{id, paired, source}]}` strictly. A parse failure → `Failed{None}`. An RPC error → `Failed{code}`.
  - Join each row with `store.load()` by exact id, and keep the daemon's order.
  - Nicknames for ids not in the list are kept in the file but not returned.
- `forget_device`:
  - Check `valid_device_id` first, else `Invalid` with nothing sent. No client → `NotReady`.
  - Then `call("devices.forget", {"device_id": id})`:
    - `Ok(_)` → remove that id's nickname (ignore a store error) and return `Forgotten`.
    - `NotPaired` → `NotPaired`. Remove the nickname here too, because the pin is gone either way.
    - Any other error → `Failed{code}`, and the nickname stays.
- `set_nickname`: an invalid id or a nickname that fails `normalize_nickname` → `Invalid`. A store write error → `Failed`. Otherwise `Saved{nickname}` with the normalized value.

**Connect by id (`commands/session.rs`).**
- `ConnectOutcome` gains `NotPaired` and `Revoked` (snake_case tags `not_paired`, `revoked`).
- `connect_with_device(client, device_id, pending) -> ConnectOutcome` works like `connect_with_code`, with three differences:
  - It checks `valid_device_id` first, else `Malformed`.
  - It sends `{"device_id": id, "timeout_ms": 60000}`.
  - It maps `NotPaired` → `NotPaired` and `Revoked` → `Revoked`. `BadCode` can't happen here, so it falls into `Failed`.
- It uses the **same** `PendingConnect` slot. A code connect and a device connect can't run together; the second gets `AlreadyPending`. The existing `session_cancel_connect` cancels either.
- **SlotGuard fix (DT-04 nit, now due):** the slot holds `(u64 token, Sender)`, with tokens from an `AtomicU64` counter. `SlotGuard` clears the slot only if it still holds **its own** token. Add a unit test in `session.rs`: guard 1 dropping after the slot holds token 2 leaves token 2 in place. Keep `cancel_pending`'s behaviour unchanged.

**Shell (`app/mod.rs`).**
- `AppState` gains `nicknames: NicknameStore`, built from the Solo `state_dir` even when no relay is configured.
- Add four commands, all returning `Ok(...)` like `session_stop`:
  - `devices_list() -> ListOutcome`
  - `devices_forget(device_id) -> ForgetOutcome`
  - `device_set_nickname(device_id, nickname) -> NicknameOutcome`
  - `session_connect_device(device_id) -> ConnectOutcome`
- Each takes the current `Ready` client the same way `session_connect_code` does.

**UI port (`devicesPort.ts`).** Mirror the three outcome types and `DeviceRow` exactly, then:

```ts
export interface DevicesPort {
  list(): Promise<ListOutcome>;
  forget(deviceId: string): Promise<ForgetOutcome>;
  setNickname(deviceId: string, nickname: string): Promise<NicknameOutcome>;
  connect(deviceId: string): Promise<ConnectOutcome>;   // ConnectOutcome from features/pair/pairPort
  cancelConnect(): Promise<boolean>;
}
export function listMessage(o: ListOutcome): string | null;
export function forgetMessage(o: ForgetOutcome): string | null;
export function connectMessage(o: ConnectOutcome): string | null;  // reuse pair outcomeMessage where it fits
```

Copy:
- `not_ready` (any outcome): "The Setu service isn't ready yet. Try again in a moment."
- List `failed`: "Couldn't load saved devices (error N)." When `code` is null: "Couldn't load saved devices."
- Forget `not_paired`: "This device was already forgotten." Forget `failed`: "Couldn't forget this device (error N). Try again."
- Connect:
  - `unavailable`: "The phone is offline or can't be reached. Check that Setu is hosting on it."
  - `not_paired`: "This device isn't paired any more. Pair it again with a new code."
  - `revoked`: "Access to this device was revoked."
  - `cancelled`: no message.
  - `already_pending`: "Another connection is already in progress."
- Nickname `invalid`: "Use 1–40 characters, or leave it empty to remove the nickname."
- `pairPort.outcomeMessage` gets the same `not_paired` and `revoked` copy, so its switch stays exhaustive.

**DeviceList.** Props are `{ port: DevicesPort; liveDeviceIds: readonly string[] }`.
- It is a `<section aria-labelledby>` with the heading **Saved devices**.
- It calls `port.list()` on mount, after a successful forget or save, and whenever the sorted, joined `liveDeviceIds` changes. A new pairing creates a pin, then a session. A stale response from an earlier call never overwrites a newer one; use a request counter.
- Show `listMessage` in `role="alert"`, with a **Refresh** button.
- Empty list: "No saved devices yet. Pair a phone to add it."
- Each row is a button labelled with the nickname (when set), the exact `device_id`, and "Presence unknown". With a nickname the label reads `"<nickname> · <device_id> · Presence unknown"`, otherwise `"<device_id> · Presence unknown"`.
- Selecting a row renders `DeviceDetail` for it. If a refresh no longer lists the selected id, clear the selection.

**DeviceDetail.** Props are `{ device: DeviceRow; connected: boolean; port: DevicesPort; onChanged(): void }`.
- The heading is the exact `device_id`, always shown, even with a nickname.
- Nickname: an input labelled **Nickname** and a **Save** button. `Saved` calls `onChanged`. `invalid` shows its copy.
- Connect:
  - When `connected`, show the text "Connected" and no Connect button.
  - Otherwise **Connect** calls `connect(device_id)` once. While it's pending, show "Connecting…" and a **Cancel** button that calls `cancelConnect()`.
  - `connected` outcome → call `onChanged`. The session card appears through the store.
  - Other outcomes → show `connectMessage` in `role="alert"`.
- Forget:
  - **Forget device** shows an inline confirmation: "Forget this device on this computer? This removes the saved pairing here. It does not revoke access on the phone. To end access now, use Disconnect, or End on the phone." It has **Forget** and **Keep** buttons.
  - **Forget** calls `forget` once. `forgotten` or `not_paired` → `onChanged`. Anything else → `forgetMessage`.
  - No modal and no `window.confirm`.

**App.** Render `<DeviceList port={devicesPort} liveDeviceIds={Object.values(sessions.live).map((s) => s.deviceId)} />` after the session cards, and only when the optional `devicesPort` prop is given (as `pairPort` is today). `main.tsx` passes `tauriDevicesPort`.

## 4. TDD: write these tests first, see them fail, then implement

- **Rust, `store/nicknames.rs` (unit, tempfile):**
  - A missing file is empty. A corrupt file is empty, and the next `set` repairs it.
  - `set` then `load` round-trips.
  - `None` removes the entry.
  - `"Pixel-7"` and `"pixel-7"` are separate keys.
  - The written JSON has `version: 1`.
  - `normalize_nickname`: `"  Work phone "` → `"Work phone"`, `""` → None, 41 chars → Err, `"a\nb"` → Err.
- **Rust, `tests/device_commands.rs` (FakeDaemon):**
  - **P08 Solo:** `devices.list` with two pins plus a stored nickname for one returns both rows in daemon order, one with its nickname. The request has no params.
  - `devices.list` with `[]` → `Listed{[]}`. A malformed result → `Failed{None}`. `-32603` → `Failed{Some(-32603)}`. No client → `NotReady`.
  - **P17 forget:** the FakeDaemon replies `{}`, and in a second case with no `result` field at all. Both give `Forgotten`; the `{}` case sends exactly `{"device_id":"pixel-7"}`, and removes the nickname.
  - `-32012` → `NotPaired`, and the nickname is removed. `-32603` → `Failed`, and the nickname is kept.
  - `""` and `"a\u{0}b"` → `Invalid` with nothing sent.
  - `set_nickname` never changes the id key: a rename of `"pixel-7"` leaves `devices.list` untouched and stores under `"pixel-7"`.
- **Rust, `tests/session_commands.rs`:**
  - `connect_with_device("pixel-7")` sends exactly `{"device_id":"pixel-7","timeout_ms":60000}` and returns `Connected`.
  - `-32011` → `Unavailable`, `-32012` → `NotPaired`, `-32014` → `Revoked`.
  - Cancel through `cancel_pending` → `Cancelled`.
  - A device connect while a code connect is pending → `AlreadyPending`.
  - `""` → `Malformed` with nothing sent.
- **UI (Vitest, fake port):**
  - DeviceList:
    - Loading, the empty copy, rows with and without a nickname (the exact labels in §3).
    - The list error with Refresh calls `list` again.
    - A stale slower response doesn't overwrite a newer one.
    - Changing `liveDeviceIds` reloads the list.
  - DeviceDetail:
    - The heading is the exact id with a nickname set.
    - Save → `setNickname` with the raw input, and `onChanged` is called. The invalid copy is shown.
    - Connect is disabled and shows "Connecting…" while pending; Cancel calls `cancelConnect`.
    - Each connect outcome's copy is shown. `connected` → "Connected" with no Connect button.
    - **P17:** Forget asks first and the copy says it does not revoke on the phone. Keep sends nothing. Forget sends one call, then `onChanged`.
  - `pairPort`: the `not_paired` and `revoked` messages.
  - App: with a `devicesPort`, the Saved devices section renders; without one, it doesn't.

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
1. Confirm it appears in Saved devices.
2. Rename it and restart the app: the nickname persists, and the id is unchanged.
3. Disconnect, then Connect from the detail: a session card appears.
4. Forget it: it leaves the list.

If you can't pair a phone, say so. Name the OS.

Use no `#[allow(...)]`, no `eslint-disable`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no non-null `!` assertions, no `unwrap()` or `expect()` outside tests, and no clippy or lint downgrades. If a gate fails for a reason you can't fix in code, stop and report the exact error.

## 6. Architecture and Karpathy pillars (enforced at review)

- **Rust/React separation.** Rust validates ids and nicknames, owns the store file and every daemon call, and joins nicknames onto rows. React shows rows and calls the port. The UI never computes a pin, an id or a file path. Nicknames never reach the daemon or the phone.
1. **Think before coding.** The PR description opens with `## Assumptions & Trade-offs`. If the daemon's `devices.list` or `devices.forget` reply differs from §0 when you run it, follow the daemon, add a test for it and record it.
2. **Simplicity first.** No SQLite, no router, no state library, no modal, no CSS. One JSON file. Keep files under ~250–300 lines; `commands/session.rs` may reach ~300.
3. **Surgical changes.** Touch only the files in §2. Branch from latest `main` as `feature/DT-08-devices-list`. Make atomic conventional commits:
   - `test(desktop): …` red
   - `feat(desktop): …` green
4. **Goal-driven TDD.** Commit the failing tests first, then the implementation. Paste the red excerpt and the full green output of every gate in the PR.

## 7. PR and hard stop

Open one PR against `main` titled `feat(desktop): DT-08 devices list, forget and nicknames`, with this body:

```
Ticket: DT-08 (docs/TDD_TICKETS.md §5) · Acceptance: P08 Solo (presence unknown; nickname never alters the id), P17 forget (no phone-side revocation promised)

## Assumptions & Trade-offs
- …

## What changed
- one line per file

## Test evidence
OS: …
<red run excerpt>
<full green output of every gate>
<tauri dev manual check: list, rename + restart, connect by id, forget, or "no phone available">

## Out of scope (left for later tickets)
- corporate directory and presence (DT-15), tray and quit (DT-09), Android 11+ pairing (DT-10)
```

Then **stop immediately**. Don't start DT-09, don't edit `docs/`, and don't merge.
