# Session Handoff

## Current Snapshot

- Active step: C1/S7 — hold minimal baseline and only add release hardening when requested.
- Run status: running.
- Last checkpoint: CP-0009.
- Blockers: none known.

## What Changed This Session

- Repository is being initialized from an empty Git workspace.
- Product positioning has been settled as two layers: `crewbee-project-context` + CrewBee.
- `.crewbee/` is the only production context directory name.
- CrewBee should integrate this package optionally, not as a core-coupled module.
- Initial CLI/API skeleton was converted to TypeScript and now builds to `dist/`.
- Diagnostics, API surface check, tests, and build passed for the initialization checkpoint.
- Template source documents were clarified as `templates/crewbee-template/`; generated/production context directories remain `.crewbee/`.
- Removed migration as a feature; directory naming is a requirement, not a runtime capability.
- Expanded doctor validation for plan/state/handoff/config consistency.
- Implemented safe update and session finalize flows.
- Expanded tests to cover invalid doctor states, path safety, update hash protection, and finalize writes.
- Project-wide constraint clarified: framework design and implementation must follow the minimalism principle.
- Removed template duplication by making `templates/crewbee-template/` the single scaffold source for `init`.
- Removed unused schema files and package/build references.
- Minimal CrewBee bridge now exposes only capsule plus `prepare/search/finalize_request` tool execution.
- `project_context_read` is intentionally not exposed to the main agent.
- Tests now cover absent `.crewbee/` behavior and the minimal CrewBee tool bridge.
- Added Chinese project guide covering framework, implementation, installation, and usage.
- Removed migration API/CLI/tests/docs and kept `.crewbee/` as the single supported production context directory.
- Converted implementation to TypeScript with small object-oriented classes and `ProjectContextService` as the internal facade.
- Aligned framework design with minimal-attention OpenCode/CrewBee runtime: prepare/search/finalize_request only, no project_context_read.
- Added internal `ProjectContextMaintainer` execution boundary and lazy finalize_request bootstrap.

## Open Blockers

- None known.

## Next Session Start Checklist

1. Run `npm run primer` or read this handoff.
2. Check `.crewbee/STATE.yaml` and `.crewbee/PLAN.yaml`.
3. Continue only with explicit release hardening or user-requested features.

## Exact Next Actions

1. Implement full Context Maintainer sub-session execution for prepare/search/finalize_request when integrating with CrewBee/OpenCode.
2. Keep main-agent prompt injection limited to Runtime Rule + Context Capsule.
3. Do not expose scaffold file paths or `project_context_read` to the main coding agent.

## References

- `.crewbee/PLAN.yaml`
- `.crewbee/STATE.yaml`
- `.crewbee/IMPLEMENTATION.md`
- `docs/PROJECT_DESIGN.md`
- `docs/zh-CN/PROJECT_GUIDE.md`
- `docs/CREWBEE_INTEGRATION.md`
