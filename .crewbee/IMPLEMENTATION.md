# Implementation Snapshot

## What Works

- Repository initialized as `@crewbee/project-context`.
- `.crewbee/` internal context workspace exists.
- Human-facing docs exist under `docs/`.
- Dependency-free ESM API/CLI skeleton exists.
- CLI supports `init`, `doctor`, `primer`, `read`, and `search`.
- CLI supports `migrate`, `update`, and `finalize`.
- Migration converts `.agent/` workspaces to `.crewbee/` and rewrites text references.
- Validation checks required `.crewbee/` files, plan/state consistency, handoff completeness, and config context directory consistency.
- Primer generation summarizes current state, next actions, memory, and read order.
- Safe update supports state merge plus handoff/memory/decision replace/append with optional hash checks.
- Finalize writes checkpoint observations and refreshes `STATE.yaml` / `HANDOFF.md`.
- `init` now reads from `templates/crewbee-template/` as the single template source; the previous in-code template duplicate was removed.
- Optional CrewBee integration is limited to compact primer generation and `read/search/finalize` tool execution.
- Tests and local verification scripts cover the initial scaffold.

## Important Paths

- `src/index.js`: public API exports.
- `src/cli/main.js`: CLI entry.
- `src/scaffold/init.js`: creates `.crewbee/` workspace.
- `src/scaffold/validate.js`: context doctor validation.
- `src/scaffold/migrate.js`: `.agent` to `.crewbee` migration.
- `src/primer/build-primer.js`: context primer builder.
- `src/search/search.js`: basic local text search.
- `src/update/update-context.js`: safe context updates.
- `src/finalize/finalize-session.js`: session finalize and observation writing.
- `src/integrations/crewbee/bridge.js`: minimal optional CrewBee prompt/tool bridge.
- `docs/`: canonical human-facing design documentation.
- `.crewbee/`: compact agent execution context.
- `templates/crewbee-template/`: scaffold source templates used to create production `.crewbee/` workspaces.

## Runtime Flow

```text
CLI/API call
  -> resolve project root
  -> detect .crewbee/
  -> read context files through store
  -> validate / build primer / search / initialize
```

## Known Gaps

- TypeScript source migration is planned after the zero-dependency MVP stabilizes.
- CrewBee runtime bridge is a minimal adapter-facing API surface, not wired into CrewBee Core.
- Template source files live under `templates/crewbee-template/`; `.crewbee/` is reserved as the production context directory name.
- Unused schema files were removed; validation remains implemented directly in `doctor` until a real schema workflow is needed.

## Verification Commands

```bash
npm run diagnostics
npm run typecheck
npm test
npm run build
```

## Last Verified

- Checkpoint: CP-0005
- Status: passed
- Evidence:
  - `npm run diagnostics` passed.
  - `npm run typecheck` passed.
  - `npm test` passed with 11 tests.
  - `npm run build` passed and generated `dist/`.
