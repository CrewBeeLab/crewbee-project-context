# Architecture

## System Map

CrewBee Project Context is a TypeScript package with a small service core and an OpenCode plugin adapter.

```text
package entrypoint / plugin
  -> service facade
  -> workspace bootstrap + validation
  -> parser/indexer
  -> context capsule / prepare brief
  -> local context search
  -> OpenCode hooks for config, tools, prepare, visibility guard/redaction, and auto update
```

## Module Responsibilities

- `src/core`: constants, shared types, and budgets.
- `src/workspace`: private workspace path handling, scaffold bootstrap from templates, validation/doctor checks, and filesystem store.
- `src/indexer`: lightweight Markdown/YAML-like parsing for state, plan, sections, and memory entries.
- `src/capsule`: low-token Project Context Brief generation with private-path sanitization and budget enforcement.
- `src/maintainer`: local text search over the compact context files.
- `src/service`: `ProjectContextService` facade for detect/init/validate/prepare/search/primer operations.
- `src/integrations/opencode`: OpenCode plugin server, config hook, visible search tool, automatic prepare, automatic update, tool guard, output redactor, maintainer prompt, and SDK client adapter.
- `src/install`: CrewBee-style local/registry install and doctor flows for user-level OpenCode config.
- `src/cli`: internal debug/CI utility; product usage is plugin-driven, not CLI-driven.

## Runtime Flow

1. OpenCode loads the sibling plugin after CrewBee.
2. Config hook injects a hidden Project Context maintainer subagent, disables recursive Project Context tools for that maintainer, blocks primary agents from directly tasking it, and ignores only runtime cache/tmp/lock noise.
3. System/chat hooks auto-create missing scaffold framework, prepare a compact context brief, and emit a short visible prepare summary without exposing private workspace structure.
4. Only `project_context_search` is registered as a visible tool, and it accepts a goal rather than file paths.
5. Tool guards block non-maintainer direct private-workspace access and direct maintainer tasking; tool-output redaction replaces private paths in non-maintainer outputs.
6. Auto update records material signals from chat/tool events, writes full update payloads to runtime cache, then launches an isolated hidden-maintainer subsession via `session.create`/`promptAsync` with only a Job ID prompt. Parent sessions are marked terminal after update completion/failure so non-user runtime/idle events cannot re-trigger update loops.

## Key Invariants

- CrewBee and Project Context are sibling plugins; Project Context must not become CrewBee Core.
- The hidden maintainer may read/write only the private context scaffold; product code changes remain out of scope for maintainer jobs.
- Primary agents must not see a context file menu, read tool, maintainer prompt, detailed update payload, or private scaffold path.
- Search is a rare fallback for concrete historical context gaps after automatic prepare/update are insufficient.
- Automatic update is best-effort auxiliary work and should log failures once rather than retrying from its own failure messages.

## Failure Handling

- Missing scaffold framework triggers bootstrap; ordinary content validation problems do not recreate or overwrite existing context.
- If OpenCode session APIs are unavailable, prepare/update degrade through logs and compact fallback behavior.
- Maintainer update payloads are removed after the maintainer runner returns success or failure; runtime TTL cleanup remains the crash/abandoned-run fallback.
- Session ownership checks skip subsessions and foreign project directories to avoid cross-project context injection or update.
