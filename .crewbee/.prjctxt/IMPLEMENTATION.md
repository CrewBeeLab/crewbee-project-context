# Implementation Snapshot

## What Works

- Package name is `crewbee-project-context`.
- Product scaffold directory is `.crewbee/.prjctxt/`; `.crewbee/` is not the product context directory.
- Template source directory is `templates/prjctxt-template/`.
- TypeScript implementation uses small object-oriented services coordinated by `ProjectContextService`.
- Internal service supports bootstrap, doctor, capsule/brief generation, context search, and safe update.
- CrewBee-facing compatibility bridge exposes only `project_context_search`.
- Real OpenCode plugin adapter exists under `src/integrations/opencode/`.
- OpenCode plugin default export is an object with `server()` and bundled entrypoint is generated at `dist/opencode-plugin.mjs`.
- OpenCode config hook injects hidden `project-context-maintainer` as `mode: subagent`.
- OpenCode tool hook registers only `project_context_search`.
- OpenCode system transform injects only a compact runtime rule and capsule.
- OpenCode tool guard prevents direct Task calls to `project-context-maintainer`.
- The plugin intentionally does not register `experimental.session.compacting`.
- Empty finalize does not bootstrap `.crewbee/.prjctxt/`; material finalize can bootstrap and then doctor validates context.
- Root package plugin entrypoint exists at `opencode-plugin.mjs`; package `main` and `exports` point to it.
- CrewBee-style user-level install / pack-local / doctor flow is implemented via `bin/crewbee-project-context.js`, `scripts/pack-local.mjs`, and `src/install/`.
- Install writes canonical OpenCode plugin entry `crewbee-project-context`, preserving recommended order after `crewbee` when present.
- Install doctor validates installed plugin entry, OpenCode config order, hidden maintainer config, task deny, three-tool surface, absence of `project_context_read`, and absence of compaction hook.
- Main-agent-facing prompt/capsule text does not expose the private Project Context workspace path.
- Capsule source file metadata is empty for main-agent-facing integrations.
- OpenCode `tool.execute.before` blocks non-maintainer direct tool args containing private workspace paths, while allowing the hidden maintainer.
- OpenCode `tool.execute.after` redacts private workspace paths from non-maintainer tool outputs.
- No `project_context_finalize` tool is exposed; update is automatic.
- Config hook appends watcher ignores for private cache/tmp/lock files.
- Install doctor validates private path guard and output redactor hooks.
- OpenCode shape readers are centralized in `src/integrations/opencode/shape-readers.ts`, covering event/status type extraction, session parent/directory extraction, and same-directory comparison.
- OpenCode automatic-update text/tool classification rules are centralized in `src/integrations/opencode/auto-update-rules.ts`; `AutoUpdateManager` keeps the state machine and public API while delegating runtime-text filtering, user/assistant text checks, material text reasons, tool material reasons, and argument stringification to this helper.
- OpenCode prepare visible-status construction and delivery is centralized in `src/integrations/opencode/prepare-status.ts`; prepare/maintainer message filtering is centralized in `src/integrations/opencode/prepare-message-filter.ts`.
- OpenCode automatic-update payload construction is centralized in `src/integrations/opencode/auto-update-payload.ts`; `AutoUpdateManager` keeps lifecycle/state orchestration while delegating job ID/path generation, git status/diff summaries, payload assembly/write, and private path redaction.
- Automatic prepare stays on the fast local-I/O `experimental.chat.system.transform` path. It computes a compact Project Context brief for model context when needed, and surfaces a separate Desktop/TUI-visible prepare summary outside normal user/assistant message history when possible. It falls back to `session.prompt(noReply/ignored)` only if toast/status APIs are unavailable, then to a synthetic ignored chat part if needed.
- Automatic update uses the official OpenCode subtask/Task flow: after material engineering changes or context-needs-population, the plugin writes a one-time private update job payload under `.crewbee/.prjctxt/cache/update-jobs/`, then submits a short `subtask` part to the parent session with `agent: project-context-maintainer`, `command: project_context_update`, and the payload file reference. OpenCode then runs the maintainer as a child session through the task tool and renders the clickable Task card linked by `metadata.sessionId`. The parent prompt does not embed full request/final-summary/git/verification details; the runtime deletes the payload file as soon as the maintainer successfully reads the referenced update-job payload, with watchdog/session cleanup as fallback.
- Automatic update completion no longer suppresses the next visible prepare through the update manager. Idle/status events do not flush visible prepare. After an update changes private context, the next real user-visible chat message can surface the visible prepare summary and mark the system brief pending; messages explicitly marked `assistant`, `system`, or `tool` are ignored. Missing role metadata is treated as user-visible rather than blocked, matching observed OpenCode Desktop message shape.
- Automatic update now requires a current-turn real `files_changed` tool event, or explicit context scaffold population. Verification-only turns, assistant summaries, ordinary user/assistant messages such as GeneralAgent plain `1`, explicit user requests to update context without file changes, and commit-only work do not trigger automatic update by themselves.
- Automatic update now tracks the assistant-idle eligibility window with `updateEligibleTurnID`; a new user turn clears old material reasons, pending-after-flight state, and eligibility so interrupted updates from a previous turn are abandoned instead of backfilled after the next user message.
- Automatic update also tracks an in-flight cancellation version; if a new real user message arrives while an update is being prepared, the stale maintainer subtask is abandoned before payload write, subtask submit, and visible-prepare marking.
- Hidden maintainer edit permission injection orders the private context allow rule before the catch-all deny rule so private scaffold updates are not shadowed.
- Project Context can be disabled per project through `.crewbee/crewbee.json`, preferably with `"crewbee-project-context": { "enabled": false }` and also accepting `crewbeeProjectContext`, `projectContext`, or `project_context` objects with boolean `enabled`. The default remains enabled when the config is missing, invalid, unreadable, or omits the flag; disabled sessions short-circuit both prepare/system-transform paths and automatic update before expensive session scanning or maintainer subtask creation.

## Important Paths

- `src/core/constants.ts`: fixed `.crewbee/.prjctxt` directory constant.
- `src/workspace/bootstrap.ts`: creates `.crewbee/.prjctxt/` from `templates/prjctxt-template/` and runs doctor validation.
- `src/capsule/context-capsule.ts`: compact Context Capsule / Task Context Brief generation.
- `src/maintainer/finalize-context.ts`: finalize, lazy bootstrap guard, observations, state/handoff updates, doctor result.
- `src/integrations/crewbee/`: compatibility bridge and tool handlers.
- `src/integrations/opencode/plugin.ts`: OpenCode server plugin entry.
- `src/integrations/opencode/config-hook.ts`: hidden maintainer agent injection and task deny.
- `src/integrations/opencode/tools.ts`: search-only OpenCode tool backed by maintainer subsession runner.
- `src/integrations/opencode/subsession-runner.ts`: OpenCode client session.create / session.prompt based maintainer runner.
- `src/integrations/opencode/system-transform-hook.ts`: compact system prompt injection.
- `src/integrations/opencode/prepare-status.ts`: prepare summary title/text, no-reply status send, and synthetic ignored fallback part construction.
- `src/integrations/opencode/prepare-message-filter.ts`: predicates for runtime prepare messages and maintainer messages that should not flush visible prepare.
- `src/integrations/opencode/tool-guard.ts`: direct Task maintainer guard.
- `src/integrations/opencode/shape-readers.ts`: shared readers for OpenCode event/status/session object shapes.
- `src/integrations/opencode/auto-update-rules.ts`: auto-update classification predicates and material-reason helpers.
- `src/integrations/opencode/auto-update-payload.ts`: update-job payload IDs/paths, git summaries, payload assembly/write, and private path redaction.
- `src/integrations/opencode/tool-output-redactor.ts`: non-maintainer tool output redaction.
- `src/integrations/opencode/visibility.ts`: shared private workspace path detection/redaction helpers.
- `src/install/`: OpenCode user-level install, config writer, package entry detection, local tarball install, and doctor.
- `bin/crewbee-project-context.js`: package CLI wrapper for install and doctor commands.
- `scripts/build.mjs`: TypeScript build plus `dist/opencode-plugin.mjs` generation.
- `scripts/pack-local.mjs`: local npm tarball packer for user-level install testing.
- `docs/PROJECT_CONTEXT_RUNTIME.md`: current OpenCode Project Context runtime implementation baseline for future automatic-update latency optimization; documents maintainer configuration/prompt, update trigger prompt, payload schema/cleanup, scaffold design, prepare consumption, and update-path cost components.

## Known Gaps

- End-to-end OpenCode Desktop smoke test with both `crewbee` and `crewbee-project-context` configured is still pending, including live validation of toast/status prepare display, Task-card update flow, payload cleanup after maintainer read, and delayed post-update visible prepare on the next real user message.
- Maintainer subsession runner and auto-update subtask flow are implemented against OpenCode client shape and covered by unit-style tests, but not yet validated against a live OpenCode Desktop runtime.
- Auto-update hook incorporates watchdog and session-cleanup logic to prevent infinite update loops and prevent permanent stalling if a maintainer subsession fails to create or aborts.
- Historical leftover update-job payloads from before the cleanup fix still need one-time manual cleanup; current runtime behavior deletes newly read update-job payloads after maintainer read.
- The whole Project Context enable-switch changes are committed, pushed to `origin/main`, and published to npm as package version `0.1.10`.
- The OpenCode integration helper-extraction refactors through automatic-update payload extraction are committed and pushed to `origin/main` as `2b121ed Refactor OpenCode project context internals`.
- The automatic-update pending-window fix from CP-0032 has been released in a subsequent patch-version publish; parent session reported commit/push, local user-level install, doctor, npm publish, and npm latest confirmation completed.
- GitHub release automation with `gh` is still unavailable in this environment; npm publish for the current patch release was completed through the npm flow reported by the parent session.

## Verification Commands

```bash
npm run diagnostics
npm run typecheck
npm test
npm run build
```

## Last Verified

- Checkpoint: CP-0034 / in-flight auto-update cancellation race fix
- Status: parent session fixed a race where a maintainer subtask could still be submitted if a new user message arrived while update preparation was in progress. Product changes are local at this checkpoint.
- Evidence so far:
  - Parent session reported targeted regression runs for the update pending-window and in-flight-preparation race tests.
  - Parent session reported `npm test -- --test-name-pattern="does not submit subtask"` passed after rebuilding/running the new regression.
  - Parent session reported full verification passed: `npm run diagnostics`, `npm test`, `npm run typecheck`, and `npm run build` executed sequentially.
  - Parent session reported final product diff review before release.
  - Parent session reported release checks passed: `npm run diagnostics`, `npm test`, `npm run typecheck`, and `npm run build`.
  - Parent session reported `npm run install:local:user` followed by `npm run doctor` passed.
  - Parent session reported npm publish and latest confirmation completed.
  - Parent session reported `npm run diagnostics` passed.
  - Parent session reported `npm test` passed 40/40 after adding the regression test.
  - Parent session reported `npm run typecheck` passed.
  - Parent session reported `npm run build` passed.
  - Reviewer was reported OKAY with no blockers.
  - Parent session reported `npm run build` passed after adding `docs/PROJECT_CONTEXT_RUNTIME.md`.
  - Parent session reported commit `c11a314 Document project context runtime implementation` was pushed and `main` was synchronized with `origin/main`.
  - Parent session reported the new document covers maintainer agent configuration, tool/permission scope, maintainer prompt, update subtask prompt, payload ID/schema/git collection/cleanup, private scaffold design, prepare consumption, and current automatic-update latency cost components.
  - Parent session reported pre-commit verification passed: `npm run diagnostics`, `npm test` passed 39/39, `npm run typecheck`, and `npm run build`.
  - Reviewer was reported OKAY before commit/push.
  - Parent session reported commit `2b121ed Refactor OpenCode project context internals` was pushed and `main...origin/main` was synchronized.
  - Parent session reported interim `npm run build` passed after payload extraction and again after payload cleanup renames.
  - Parent session reported final full verification passed: `npm run diagnostics`, `npm test`, `npm run typecheck`, and `npm run build`.
  - Parent session reported independent review completed with no behavior-equivalence blockers.
  - Parent session reported a second behavior-equivalent OpenCode integration refactor completed locally and not committed/published. It extracted prepare visible-status/message-filter helpers and clarified adapter type names while keeping public API, config semantics, sentinels, metadata keys, permission policy, and prepare/update behavior unchanged.
  - Parent session reported `npm run diagnostics`, `npm test` passed 39/39, `npm run typecheck`, and `npm run build` passed after the prepare-helper extraction and adapter type rename.
  - Reviewer was reported OKAY by the parent session with no blockers.
  - Parent session reported `npm run diagnostics`, `npm test` passed 39/39, `npm run typecheck`, and `npm run build` passed after the refactor.
  - Parent session reported interim `npm run build` passed after shape-reader extraction, auto-update rule extraction, and import correction.
  - Reviewer was reported OKAY by the parent session with no behavior-equivalence blockers.
  - Parent session reported `tool-guard` internal recursive parent reader was renamed to `readNestedParentID` to clarify its broader recursive semantics.
  - Parent session reported npm `latest` is `0.1.10` with shasum `b7c57e55c27027637f074e4ab10a46a8565214ba`.
  - Parent session reported release verification passed: `npm run diagnostics`, `npm test` 39/39, `npm run typecheck`, and `npm run build`.
  - Parent session reported `.crewbee/crewbee.json` can disable the whole Project Context integration with `"crewbee-project-context": { "enabled": false }`, while missing/invalid/unreadable config defaults to enabled.
  - Parent session reported disabled configuration short-circuits both prepare and update entry paths before `session.get`, `session.messages`, or maintainer subtask creation, and the old update-only `projectContext.update.enabled` semantics are no longer retained.
  - Parent session reported `npm run diagnostics`, `npm test` passed 39/39, `npm run typecheck`, and `npm run build` passed.
  - Reviewer was reported OKAY by the parent session.
  - Parent session reported GeneralAgent plain `1` no longer triggers automatic update, prepare still works for missing-role user-visible messages, and hidden maintainer private edit allow precedes the catch-all deny.
  - Parent session reported `npm test` passed 30/30, `npm run diagnostics` passed, `npm run build` passed, and `npm run typecheck` passed after a rerun. The first parallel typecheck/build attempt had a `dist` cleanup race (`ENOTEMPTY`), then standalone typecheck passed.
  - Reviewer was reported OKAY by the parent session.
  - Context maintainer ran `npm run doctor` after CP-0023; output reported `healthy: true`, canonical plugin entry `crewbee-project-context@0.1.2`, hidden maintainer configured, private path guard/redactor present, search-only surface, no `project_context_read`, no compaction hook, and maintainer Task denied for the primary agent.
  - Context maintainer ran `npm run doctor` after CP-0022; output reported `healthy: true`, canonical plugin entry `crewbee-project-context@0.1.2`, hidden maintainer configured, private path guard/redactor present, search-only surface, no `project_context_read`, no compaction hook, and maintainer Task denied for the primary agent.
  - Observed `git log -3 --oneline` with `3e4f6a3 Fix project context update cleanup gating` at HEAD, and `git status --short --branch` reported `main...origin/main` with no ahead/behind marker for product code.
  - Ran `npm run doctor`; output reported `healthy: true`, canonical plugin entry `crewbee-project-context@0.1.2`, hidden maintainer configured, private path guard/redactor present, search-only surface, no `project_context_read`, no compaction hook, and maintainer Task denied for the primary agent.
  - Parent session reported `npm test`, `npm run diagnostics`, `npm run typecheck`, and `npm run build` passed for the missing-role visible-prepare fix; tests reported 29/29.
  - Reviewer was reported OKAY by the parent session.
  - Context maintainer ran `npm run doctor`; output reported `healthy: true`, canonical plugin entry `crewbee-project-context@0.1.2`, hidden maintainer configured, private path guard/redactor present, search-only surface, no `project_context_read`, and no compaction hook.
  - Parent update job reported running `npm run install:local:user; if ($?) { npm run doctor }; if ($?) { git status --short --branch }` after commit/push.
  - Previous CP-0018 commit `0f96c4b Fix project context prepare timing` was reported pushed to `origin/main` and synchronized.
