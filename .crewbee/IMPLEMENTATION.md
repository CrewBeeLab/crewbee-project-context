# Implementation Snapshot

## What Works

- Repository initialized as `@crewbee/project-context`.
- `.crewbee/` internal context workspace exists.
- Human-facing docs exist under `docs/`.
- Chinese project guide exists at `docs/zh-CN/PROJECT_GUIDE.md`.
- TypeScript runtime extension and internal service implementation exists.
- Core implementation uses small object-oriented classes coordinated by `ProjectContextService`.
- CLI is reduced to internal doctor/primer diagnostics and is not published as the product workflow.
- Main CrewBee/OpenCode tool surface is `project_context_prepare`, `project_context_search`, and `project_context_finalize_request`.
- `.crewbee/` is the only production context directory name; migration from other names is intentionally not a feature.
- Validation checks required `.crewbee/` files, plan/state consistency, and handoff completeness.
- Capsule generation summarizes current state, next actions, and memory without exposing scaffold file read order.
- Safe update supports state merge plus handoff/memory/decision replace/append with optional hash checks.
- Finalize writes checkpoint observations, refreshes `STATE.yaml` / `HANDOFF.md`, and runs doctor validation before returning.
- `init` now reads from `templates/crewbee-template/` as the single template source; the previous in-code template duplicate was removed.
- Optional CrewBee integration is limited to compact capsule generation and `prepare/search/finalize_request` tool execution.
- `project_context_read` is intentionally not exposed; scaffold file selection is delegated to Context Maintainer.
- `ProjectContextMaintainer` provides the internal prepare/search/finalize_request execution boundary.
- `finalize_request` bootstraps `.crewbee/` when material progress exists and the workspace is absent.
- Empty `finalize_request` calls do not bootstrap `.crewbee/`; absent-workspace bootstrap requires material progress.
- Tests and local verification scripts cover the initial scaffold, minimal public package surface, lazy finalize bootstrap, no-material-progress bootstrap guard, and post-finalize doctor result.

## Important Paths

- `src/index.ts`: minimal public sidecar API exports for CrewBee/OpenCode integration.
- `src/cli/main.ts`: internal doctor/primer diagnostic entrypoint.
- `src/service/project-context-service.ts`: object-oriented facade coordinating all modules.
- `src/workspace/bootstrap.ts`: creates `.crewbee/` workspace and runs doctor validation.
- `src/capsule/context-capsule.ts`: context capsule and task brief builder.
- `src/maintainer/search-context.ts`: maintainer-driven context search.
- `src/maintainer/apply-patch.ts`: safe context updates.
- `src/maintainer/finalize-context.ts`: finalize request, lazy bootstrap, observation writing, and post-finalize doctor validation.
- `src/maintainer/project-context-maintainer.ts`: internal Context Maintainer execution boundary.
- `src/integrations/crewbee/extension.ts`: minimal optional CrewBee/OpenCode extension.
- `src/integrations/crewbee/tool-definitions.ts`: prepare/search/finalize_request tool names.
- `src/integrations/crewbee/tool-handlers.ts`: tool execution routed through Maintainer.
- `src/integrations/crewbee/prompt-fragment.ts`: capsule prompt fragment builder.
- `src/integrations/crewbee/internal-agent.ts`: internal maintainer agent metadata.
- `docs/`: canonical human-facing design documentation.
- `docs/zh-CN/PROJECT_GUIDE.md`: Chinese guide for framework, implementation, installation, and usage.
- `.crewbee/`: compact agent execution context.
- `templates/crewbee-template/`: scaffold source templates used to create production `.crewbee/` workspaces.

## Runtime Flow

```text
CrewBee/OpenCode extension call
  -> resolve project root
  -> detect .crewbee/
  -> build compact prompt fragment
  -> route prepare/search/finalize_request through maintainer
  -> lazy bootstrap only during finalize_request when needed
  -> run doctor after finalize writes
```

## Known Gaps

- CrewBee runtime bridge is a minimal adapter-facing API surface, not wired into CrewBee Core.
- Real OpenCode plugin hook wiring, CrewBee runloop tool registration, and internal maintainer sub-session mapping belong in the CrewBee runtime repository and are tracked as planned C2/S8 work.
- Public package exports are intentionally limited to sidecar integration helpers; direct init/read/update/finalize wrappers remain internal service methods only.
- Template source files live under `templates/crewbee-template/`; `.crewbee/` is reserved as the production context directory name.
- Unused schema files were removed; validation remains implemented directly in `doctor` until a real schema workflow is needed.
- Directory renaming/migration is intentionally out of scope; use `.crewbee/` directly.
- `config.yaml` no longer exposes a context directory field; `.crewbee/` is fixed by code constants.

## Verification Commands

```bash
npm run diagnostics
npm run typecheck
npm test
npm run build
```

## Last Verified

- Checkpoint: CP-0010
- Status: passed
- Evidence:
  - `npm run diagnostics` passed.
  - `npm run typecheck` passed.
  - `npm test` passed with 14 tests.
  - `npm run build` passed and generated `dist/`.
