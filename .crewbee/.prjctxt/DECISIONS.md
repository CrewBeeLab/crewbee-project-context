# Decisions

- Accepted strict minimalism: plain files and local text search first; no database, vector index, background daemon, UI, or extra schema until a concrete context-cost/safety need exists.
- Project Context remains a sibling OpenCode plugin to CrewBee, not CrewBee Core and not a visible CrewBee team member.
- Main-agent surface is intentionally limited to automatic init/prepare/update plus a single rare-fallback `project_context_search` goal tool; no `project_context_read` or visible context file menu.
- Private workspace visibility is a hard invariant: no private paths in primary prompts/capsules/tool args/non-maintainer outputs; guards and redaction enforce this at the OpenCode adapter layer.
- Automatic update uses an isolated hidden-maintainer subsession (`session.create` + `promptAsync`) instead of parent-session subtask prompting. Parent prompt contains only a Job ID; full payload is persisted in runtime cache for the maintainer to read.
- The plugin avoids `experimental.session.compacting`; prepare is handled by system/chat message transforms and update by events/tool hooks/session idle.
- Runtime update failures are best-effort auxiliary failures: log once, do not block primary work, and avoid retry loops from Project Context's own status/failure messages.
- Runtime update payload cache entries should be removed after the maintainer runner completes on either success or failure; TTL cleanup is only the crash/abandonment fallback.
- After an update completes/fails, the parent session is treated as terminal for Project Context update purposes until a new real user message arrives; runtime status/idle messages must not trigger another update.
