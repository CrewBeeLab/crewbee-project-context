# Implementation Snapshot

## What Works

- Package name is `crewbee-project-context`.
- Product scaffold directory is `.crewbee/.prjctxt/`; `.crewbee/` is not the product context directory.
- Template source directory is `templates/prjctxt-template/`.
- TypeScript implementation uses small object-oriented services coordinated by `ProjectContextService`.
- Internal service supports bootstrap, doctor, capsule/brief generation, context search, safe update, and finalize.
- CrewBee-facing compatibility bridge exposes only `project_context_prepare`, `project_context_search`, and `project_context_finalize`.
- Real OpenCode plugin adapter exists under `src/integrations/opencode/`.
- OpenCode plugin default export is an object with `server()` and bundled entrypoint is generated at `dist/opencode-plugin.mjs`.
- OpenCode config hook injects hidden `project-context-maintainer` as `mode: subagent`.
- OpenCode tool hook registers only `project_context_prepare`, `project_context_search`, and `project_context_finalize`.
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
- OpenCode finalize tool returns path-free status text instead of internal scaffold file names.
- Config hook appends watcher ignores for private cache/tmp/lock files.
- Install doctor validates private path guard and output redactor hooks.
- Automatic prepare stays on the fast local-I/O `experimental.chat.system.transform` path and does not write `noReply` messages into the parent session.
- Automatic update now uses the official OpenCode subtask/Task flow: the plugin submits a `subtask` part to the parent session via `promptAsync`, OpenCode creates a clickable `task` execution card, and that card links to the Maintainer child session through `metadata.sessionId`.

## Important Paths

- `src/core/constants.ts`: fixed `.crewbee/.prjctxt` directory constant.
- `src/workspace/bootstrap.ts`: creates `.crewbee/.prjctxt/` from `templates/prjctxt-template/` and runs doctor validation.
- `src/capsule/context-capsule.ts`: compact Context Capsule / Task Context Brief generation.
- `src/maintainer/finalize-context.ts`: finalize, lazy bootstrap guard, observations, state/handoff updates, doctor result.
- `src/integrations/crewbee/`: compatibility bridge and tool handlers.
- `src/integrations/opencode/plugin.ts`: OpenCode server plugin entry.
- `src/integrations/opencode/config-hook.ts`: hidden maintainer agent injection and task deny.
- `src/integrations/opencode/tools.ts`: three OpenCode tools backed by maintainer subsession runner.
- `src/integrations/opencode/subsession-runner.ts`: OpenCode client session.create / session.prompt based maintainer runner.
- `src/integrations/opencode/system-transform-hook.ts`: compact system prompt injection.
- `src/integrations/opencode/tool-guard.ts`: direct Task maintainer guard.
- `src/integrations/opencode/tool-output-redactor.ts`: non-maintainer tool output redaction.
- `src/integrations/opencode/visibility.ts`: shared private workspace path detection/redaction helpers.
- `src/install/`: OpenCode user-level install, config writer, package entry detection, local tarball install, and doctor.
- `bin/crewbee-project-context.js`: package CLI wrapper for install and doctor commands.
- `scripts/build.mjs`: TypeScript build plus `dist/opencode-plugin.mjs` generation.
- `scripts/pack-local.mjs`: local npm tarball packer for user-level install testing.

## Known Gaps

- End-to-end OpenCode startup smoke test with both `crewbee` and `crewbee-project-context` configured is still pending.
- Maintainer subsession runner is implemented against OpenCode client shape and covered by unit-style tests, but not yet validated against a live OpenCode runtime.
- GitHub release v0.1.0 is not completed in this environment because the `gh` CLI is unavailable.

## Verification Commands

```bash
npm run diagnostics
npm run typecheck
npm test
npm run build
```

## Last Verified

- Checkpoint: pending CP-0012 closeout
- Status: in progress
- Evidence so far:
  - `npm run diagnostics` passed after private workspace visibility implementation.
  - `npm run typecheck` passed after private workspace visibility implementation.
  - `npm test` passed with 18 tests after private workspace visibility implementation.
  - `npm run build` passed after private workspace visibility implementation.
