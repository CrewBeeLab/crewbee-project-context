# Memory Index

- MEM-001 [architecture]: This repository owns both the Project Context workspace convention and its OpenCode/CrewBee integration; there is no separate standards repository.
- MEM-002 [privacy]: Never expose the private scaffold file structure to primary agents; search accepts a goal and maintainer/runtime internals handle file access.
- MEM-003 [runtime]: Auto prepare injects a compact runtime rule + brief and surfaces a visible prepare summary while filtering that synthetic runtime text from future model context.
- MEM-004 [runtime]: Auto update triggers from material chat/tool signals, writes cached payload JSON, then launches an isolated hidden-maintainer subsession with only a Job ID prompt; the parent session is terminal-marked until a fresh user message.
- MEM-005 [testing]: Tests assert search-only public surface, no direct context reads, no private path leakage, guard/redactor behavior, hidden maintainer config, client adapter SDK shapes, and auto prepare/update flows.
- MEM-006 [verification]: Latest parent session reported `npm run build`, `npm test`, `npm run typecheck`, `npm run diagnostics`, and `npm run doctor` passing after the isolated-update/terminal-session fix; rerun if the final diff changes.
- MEM-007 [runtime]: Update-job payload files are expected to be cleaned after maintainer success or failure, with TTL cleanup retained only for crashes/abandoned runs.
- MEM-008 [runtime]: Auto-update must not ask the main agent/user side to execute a maintainer task; the supported path is an isolated hidden-maintainer subsession using `promptAsync` and Job ID-only prompting.
