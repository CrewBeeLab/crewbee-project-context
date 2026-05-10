# Memory Index

- ID: M-0001
  Type: decision
  Summary: Use `.crewbee/.prjctxt/` as the only production project context workspace directory.
  Affects: scaffold, templates, CrewBee integration
  References: `.crewbee/.prjctxt/DECISIONS.md#d-0001`

- ID: M-0002
  Type: decision
  Summary: Keep CrewBee Project Context standalone and let CrewBee integrate it optionally without core coupling.
  Affects: architecture, package boundaries
  References: `.crewbee/.prjctxt/DECISIONS.md#d-0002`

- ID: M-0003
  Type: rule
  Summary: Plans are step/checkpoint based and must not depend on real-world calendar dates.
  Affects: planning, STATE.yaml, PLAN.yaml
  References: `.crewbee/.prjctxt/PROJECT.md`

- ID: M-0004
  Type: decision
  Summary: Store scaffold source documents under `templates/prjctxt-template/`; reserve `.crewbee/.prjctxt/` for production project context workspaces.
  Affects: templates, scaffold, documentation
  References: `.crewbee/.prjctxt/DECISIONS.md#d-0004`

- ID: M-0005
  Type: discovery
  Summary: The runtime direction is OpenCode + CrewBee plug-and-play with prepare/search/finalize_request and maintainer-delegated scaffold work.
  Affects: CLI, API, tests, planning
  References: `.crewbee/.prjctxt/observations/CP-0003.md`

- ID: M-0008
  Type: rule
  Summary: Directory migration is not a product feature; projects should initialize and use `.crewbee/.prjctxt/` directly.
  Affects: scaffold, CLI, docs
  References: `.crewbee/.prjctxt/observations/CP-0007.md`

- ID: M-0009
  Type: discovery
  Summary: Implementation is being converted to TypeScript with small object-oriented classes coordinated by `ProjectContextService`.
  Affects: src, build, tests, package
  References: `.crewbee/.prjctxt/observations/CP-0008.md`

- ID: M-0006
  Type: rule
  Summary: Framework design and implementation must follow the minimalism principle; add complexity only when it directly reduces agent context cost or prevents a concrete safety problem.
  Affects: architecture, implementation, CrewBee integration
  References: `.crewbee/.prjctxt/DECISIONS.md#d-0005`

- ID: M-0007
  Type: discovery
  Summary: Minimalism pass removed template double sources and unused schemas; CrewBee bridge is limited to capsule plus prepare/search/finalize_request.
  Affects: scaffold, package, build, CrewBee integration
  References: `.crewbee/.prjctxt/observations/CP-0005.md`

- ID: M-0010
  Type: decision
  Summary: Do not expose `project_context_read`; main agents request prepare/search/finalize_request and Context Maintainer handles scaffold structure.
  Affects: CrewBee integration, prompt, tool surface
  References: `docs/zh-CN/PROJECT_GUIDE.md`

- ID: M-0011
  Type: decision
  Summary: `crewbee-project-context` is a sibling OpenCode plugin with root `opencode-plugin.mjs`, hidden maintainer, three tools, and CrewBee-style user-level install/doctor flow.
  Affects: package, OpenCode plugin loading, install, doctor
  References: `.crewbee/.prjctxt/observations/CP-0013.md`

- ID: M-0012
  Type: rule
  Summary: The private Project Context workspace must be invisible to the main Agent through prompt/capsule text, tool args, and non-maintainer tool outputs; access goes through prepare/search/finalize.
  Affects: OpenCode hooks, capsule, tool guard, output redaction
  References: `.crewbee/.prjctxt/observations/CP-0014.md`

- ID: M-0013
  Type: decision
  Summary: Automatic prepare remains system-transform-only; automatic update uses OpenCode's official subtask/Task flow to render a clickable maintainer child-session execution card.
  Affects: OpenCode hooks, Desktop UI observability, maintainer child sessions
  References: `.crewbee/.prjctxt/observations/CP-0015.md`

- ID: M-0014
  Type: decision
  Summary: Prepare visible status should prefer toast/status APIs; after automatic updates, idle/status and assistant/non-user messages must not flush visible prepare, but the next real user message may surface it and request a system brief.
  Affects: OpenCode system transform, auto-update hook, Desktop/TUI UX
  References: `.crewbee/.prjctxt/DECISIONS.md#d-0008`, `.crewbee/.prjctxt/observations/CP-0017.md`

- ID: M-0015
  Type: rule
  Summary: OpenCode automatic update is gated by material engineering file changes or context population, and update-job payloads are removed after the maintainer reads them; verification-only and commit-only turns do not trigger updates.
  Affects: OpenCode auto-update hook, private update-job cache, tests
  References: `.crewbee/.prjctxt/observations/CP-0019.md`

- ID: M-0016
  Type: rule
  Summary: Visible prepare must not require `role: "user"`; OpenCode Desktop may emit user-visible `chat.message` payloads without role metadata, so only explicit assistant/system/tool roles should be blocked.
  Affects: OpenCode system transform, Desktop/TUI prepare visibility, tests
  References: `.crewbee/.prjctxt/observations/CP-0021.md`

- ID: M-0017
  Type: rule
  Summary: Automatic update requires a current-turn real file-change event or scaffold population; plain messages, assistant summaries, verification-only turns, and commit-only work are insufficient.
  Affects: OpenCode auto-update hook, maintainer Task flow, tests
  References: `.crewbee/.prjctxt/DECISIONS.md#d-0009`, `.crewbee/.prjctxt/observations/CP-0023.md`

- ID: M-0018
  Type: rule
  Summary: Projects can disable the whole Project Context integration with `.crewbee/crewbee.json` using `"crewbee-project-context": { "enabled": false }`; default behavior remains enabled when config is absent or invalid.
  Affects: OpenCode system transform hook, OpenCode auto-update hook, project configuration, tests
  References: `.crewbee/.prjctxt/DECISIONS.md#d-0011`, `.crewbee/.prjctxt/observations/CP-0025.md`

- ID: M-0019
  Type: discovery
  Summary: OpenCode integration helper extraction now separates shape readers, auto-update rules, prepare status/message filtering, and automatic-update payload construction while preserving runtime orchestration in the hooks/managers.
  Affects: OpenCode integration maintainability, auto-update hook, system-transform hook
  References: `.crewbee/.prjctxt/observations/CP-0028.md`, `.crewbee/.prjctxt/observations/CP-0029.md`

- ID: M-0020
  Type: rule
  Summary: Automatic update eligibility is turn-scoped; a new user turn abandons old material/pending update state so prior-turn updates are not backfilled after the next user message.
  Affects: OpenCode auto-update hook, maintainer Task flow, tests
  References: `.crewbee/.prjctxt/observations/CP-0032.md`

- ID: M-0021
  Type: rule
  Summary: In-flight automatic update preparation is cancellation-version scoped; a new real user message during preparation must prevent stale payload write, maintainer subtask submission, and visible-prepare marking.
  Affects: OpenCode auto-update hook, maintainer Task flow, race tests
  References: `.crewbee/.prjctxt/observations/CP-0034.md`
