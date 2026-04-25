# Implementation Snapshot

## What Works

- Package name is `crewbee-project-context`.
- Product scaffold directory is `.crewbeectxt/`; `.crewbee/` is not the product context directory.
- Template source directory is `templates/crewbeectxt-template/`.
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
- Empty finalize does not bootstrap `.crewbeectxt/`; material finalize can bootstrap and then doctor validates context.

## Important Paths

- `src/core/constants.ts`: fixed `.crewbeectxt` directory constant.
- `src/workspace/bootstrap.ts`: creates `.crewbeectxt/` from `templates/crewbeectxt-template/` and runs doctor validation.
- `src/capsule/context-capsule.ts`: compact Context Capsule / Task Context Brief generation.
- `src/maintainer/finalize-context.ts`: finalize, lazy bootstrap guard, observations, state/handoff updates, doctor result.
- `src/integrations/crewbee/`: compatibility bridge and tool handlers.
- `src/integrations/opencode/plugin.ts`: OpenCode server plugin entry.
- `src/integrations/opencode/config-hook.ts`: hidden maintainer agent injection and task deny.
- `src/integrations/opencode/tools.ts`: three OpenCode tools backed by maintainer subsession runner.
- `src/integrations/opencode/subsession-runner.ts`: OpenCode client session.create / session.prompt based maintainer runner.
- `src/integrations/opencode/system-transform-hook.ts`: compact system prompt injection.
- `src/integrations/opencode/tool-guard.ts`: direct Task maintainer guard.
- `scripts/build.mjs`: TypeScript build plus `dist/opencode-plugin.mjs` generation.

## Known Gaps

- CrewBee user-level installer parity is not fully implemented yet: no `install:local:user` / `doctor` flow that writes OpenCode config like CrewBee.
- End-to-end OpenCode startup smoke test with both `crewbee` and `crewbee-project-context` configured is still pending.
- Maintainer subsession runner is implemented against OpenCode client shape and covered by unit-style tests, but not yet validated against a live OpenCode runtime.

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
  - `npm run diagnostics` passed.
  - `npm run typecheck` passed.
  - `npm test` passed with 16 tests.
