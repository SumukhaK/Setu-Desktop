# Setu-Desktop · codebase memory

Read this first. It replaces a repo scan. Keep it under 150 lines; update it in every post-merge ritual.

Last updated: 2026-11-19 · main @ bootstrap (pre DT-01) · SDK baseline: Setu-SDK v1.1.0 (`SumukhaK/Setu` tag `v1.1.0`, commit `921aded`)

## Pipeline

- Architect/reviewer: Claude. Builders: one ticket per PR from `docs/TDD_TICKETS.md`, branch from latest `main`.
- Active builder prompt: `docs/prompts/CURRENT_TASK.md`. Review fixes: `docs/REVIEW_FIX_PROMPT.md` (exists only while a PR needs changes).
- Acceptance tests: `docs/JOURNEYS.md` P01–P22 (canonical for both repos). Screens: `docs/SCREENS.md` D01–D10.
- SDK contract: https://github.com/SumukhaK/Setu/blob/v1.1.0/API_SPEC.md (§2 daemon JSON-RPC, §2.3 error table, §1.5 events).

## Stack (fixed in TDD_TICKETS.md §4)

- Tauri v2. Rust native core in `src-tauri/`; React + Vite + TypeScript (`strict: true`, no `any`) UI in `src/`.
- Rust gates: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- UI gates (from the first ticket that adds `src/`): ESLint, Prettier, `tsc --noEmit`, Vitest + Testing Library.
- UI reaches the daemon only through Tauri commands. Tokens, pairing codes and process control stay in Rust.
- `setu-daemon` v1.1.0 is a bundled sidecar per OS/arch (DT-02).

## Directory map

```
README.md            prototype instructions
index.html styles.css  browser wireframe prototype (fixtures, not app code)
docs/
  JOURNEYS.md        J1–J5 journeys, P01–P22 acceptance tests
  SCREENS.md         D01–D10 screen inventory, RPC allowlist
  TDD_TICKETS.md     re-review + DT-01..DT-16 / AT-01..AT-10, status tracker
  CODEBASE_MEMORY.md this file
  prompts/CURRENT_TASK.md  active builder prompt
  previews/ walkthrough/   images and historical video
```

No application code exists yet. `src-tauri/` arrives with DT-01, `src/` with DT-03.

## Key public interfaces

(none yet; fill from merged PRs: module path, type/fn signature, one line of purpose)

## Wired SDK v1.1.0 bindings

| RPC / event | Wired in | Ticket |
| --- | --- | --- |
| (none yet) | | |

## Architecture decisions (binding on builders)

- AD-1 (DT-01): `src-tauri` starts as a plain Rust library crate `setu_desktop` with no `tauri` dependency. DT-02 adds the Tauri app shell, `tauri.conf.json` and the sidecar.
- AD-2 (DT-01): RPC errors map by numeric `code`; `data.kind` is kept for display/logs. Unknown server codes become `SetuError::Denied { code, kind, message }`. Never guess a specific error.
- AD-3 (DT-01): Any framing or protocol violation from the daemon (line over 1 MiB, invalid JSON, EOF) closes the connection and fails every pending call with `SetuError::Disconnected`. DT-02's supervisor owns reconnecting.
- AD-4 (DT-01): `-32027 busy` is retried once inside the client after a short backoff (safe: the daemon did not run the request). A second busy is returned to the caller.
- AD-5: Never log or persist RPC params or results that can hold secrets (`auth.token`, `pairing_code`, JWTs, proxy credentials). DT-10 adds the redaction layer.

## Completed tickets

| Ticket | PR | Summary |
| --- | --- | --- |
| (none yet) | | |

## Open items

- Next ticket: DT-01 · JSON-RPC client core (prompt issued).
- DT-03 is the first ticket with `src/`: its prompt must include the minimal Vite + React + TS strict + ESLint + Prettier + Vitest scaffold.
- No CI yet. Builders paste local gate output into the PR. Consider a CI workflow as an `upkeep/` ticket after DT-02.
- SDK v1.1.1 asks and backend items: TDD_TICKETS.md §7 (peer_user, transport on session_up, expires_at, org token service).
- DT-10 stays behind a flag until the device-lab gate in §7 passes.
