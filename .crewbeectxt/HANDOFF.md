# Session Handoff

## Current Snapshot

- Active step: C1/S7 — Hold minimal baseline and only add release hardening when requested.
- Run status: running.
- Last checkpoint: CP-0012.
- Blockers: none known.

## What Changed This Session

Implemented the latest project-context plugin design: product scaffold moved to .crewbeectxt, OpenCode server plugin entry added, hidden project-context-maintainer config hook added, prepare/search/finalize tools run through maintainer subsessions, system transform stays compact, compaction hook is intentionally absent, and direct Task maintainer calls are guarded.

## Open Blockers

- None known.

## Next Session Start Checklist

1. Read this handoff.
2. Check .crewbeectxt/STATE.yaml and .crewbeectxt/PLAN.yaml.
3. Use .crewbeectxt/IMPLEMENTATION.md before broad code exploration.

## Exact Next Actions

1. Implement CrewBee-style user-level install and doctor flow for crewbee-project-context.
2. Run an end-to-end OpenCode startup smoke test with plugin config [crewbee, crewbee-project-context].
3. Validate maintainer subsession behavior against a live OpenCode runtime.

## References

- .crewbeectxt/PLAN.yaml
- .crewbeectxt/STATE.yaml
- .crewbeectxt/IMPLEMENTATION.md
- .crewbeectxt/MEMORY_INDEX.md
