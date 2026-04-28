# Implementation Snapshot

## What Works

- TypeScript package `crewbee-project-context@0.1.1` exports an OpenCode plugin from `opencode-plugin.mjs` plus an internal CLI binary.
- Scaffold bootstrap creates required context files from `templates/crewbeectxt-template/`, plus cache/observation directories, and doctor validates required files, active plan/state consistency, and handoff next actions.
- `ProjectContextService` supports detect, init, validate, primer/brief generation, and local search without exposing direct context file reads as public API.
- Context capsule generation reads project/state/plan/handoff/implementation/memory and optionally architecture/decisions, enforces token budget, and sanitizes private workspace names.
- OpenCode plugin hooks are implemented for config, visible search tool, automatic prepare, runtime message filtering, direct tool guards, output redaction, and automatic update.
- Config hook injects hidden `project-context-maintainer`, denies recursive Project Context/session tools, denies maintainer tasking by primary/all agents, disables Project Context tools for subagents, and ignores private runtime cache/tmp/locks.
- Auto prepare uses system/chat/message/idling hooks to inject a compact runtime rule + Project Context Brief and surface a visible prepare summary via TUI toast and/or ignored synthetic chat part.
- Auto update detects material changes from assistant/user text, file-edit tools, verification commands, and context search; it captures git status/diff summaries, persists a private payload, and launches an isolated hidden-maintainer subsession with a Job ID-only prompt.
- Tool guard and redactor protect private workspace access for non-maintainer sessions while allowing active runtime update maintainer sessions to read their persisted payload.
- Install/doctor flow aligns with CrewBee user-level OpenCode plugin setup and checks plugin order, maintainer config, private guard/redactor, search-only surface, and absence of compaction hook.

## Important Paths

- Package metadata and scripts: `package.json`.
- Product/design docs: `README.md`, `docs/PROJECT_DESIGN.md`, `docs/CREWBEE_INTEGRATION.md`, `docs/INTERNAL_DEVELOPMENT.md`, `docs/zh-CN/PROJECT_GUIDE.md`.
- Service/core implementation: `src/service/project-context-service.ts`, `src/workspace/bootstrap.ts`, `src/capsule/context-capsule.ts`.
- OpenCode runtime adapter: `src/integrations/opencode/plugin.ts`, `system-transform-hook.ts`, `auto-update-hook.ts`, `config-hook.ts`, `tool-guard.ts`, `visibility.ts`, `client-adapter.ts`, `subsession-runner.ts`.
- Tests: `tests/project-context.test.js`.

## Known Gaps / Risks

- Auto update and prepare depend on OpenCode SDK/session shapes; tests cover v1 nested and v2 flat forms, but upstream API changes remain a risk.
- The private workspace privacy boundary relies on adapter guards/redaction plus prompt discipline; keep tests focused on non-exposure regressions.
- Runtime update payloads are now cleaned after maintainer success/failure; if the process crashes before cleanup, TTL cleanup remains the fallback.
- Parent sessions are marked terminal after an update completes/fails; non-user runtime/idling events are ignored until a new real user message arrives, preventing forced-stop or status-message update loops.
- Working tree reportedly still contains broad unrelated edits/deletions outside the latest cache-cleanup fix; avoid treating all diffs as one coherent change without review.
- Latest maintainer payload (`pcu_moizikmg_8gx0pryb`) confirms the prior auto-update fix intent: future updates should run through isolated hidden-maintainer subsessions with `promptAsync`, not parent/main-agent maintainer tasks.

## Last Material Change Summary

- Latest product-code fix moved automatic update from parent-session `session.prompt` subtasking to isolated maintainer subsessions via `session.create`/`promptAsync`, preventing update completion from returning control to the main agent LLM.
- The auto-update manager now terminal-marks the parent session after update completion/failure and skips subsequent non-user runtime/idling events until a fresh user message, avoiding duplicate updates after forced stop/status chatter.
- Related cleanup ensures cached update-job payloads are removed after maintainer success/failure; TTL cleanup remains a crash fallback. A delegated coding review initially found failure-path cleanup missing; follow-up fix was reviewed again with no blocker reported.
- Follow-up update `pcu_moizikmg_8gx0pryb` reported no new decisions/blockers beyond confirming the old explicit maintainer-task path should no longer be used by auto-update.

## Verification Commands

- `npm run build` — passed in parent session after isolated-update fix.
- `npm test` — passed in parent session after isolated-update fix; reported 28/28 pass.
- `npm run typecheck` — passed in parent session after isolated-update fix.
- `npm run diagnostics` — passed in parent session after isolated-update fix.
- `npm run doctor` — passed in parent session after isolated-update fix; maintainer also reran doctor after context update for `pcu_moizh9dl_54c4ofwg` and it reported `healthy: true`.
- `npm run doctor` — latest parent-session final text for `pcu_moizikmg_8gx0pryb` again reported healthy; maintainer also reran it for this context update and it reported `healthy: true`.
