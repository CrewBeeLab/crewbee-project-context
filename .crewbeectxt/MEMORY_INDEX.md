# Memory Index

- ID: M-0001
  Type: decision
  Summary: Use `.crewbeectxt/` as the only production project context workspace directory.
  Affects: scaffold, templates, CrewBee integration
  References: `.crewbeectxt/DECISIONS.md#d-0001`

- ID: M-0002
  Type: decision
  Summary: Keep CrewBee Project Context standalone and let CrewBee integrate it optionally without core coupling.
  Affects: architecture, package boundaries
  References: `.crewbeectxt/DECISIONS.md#d-0002`

- ID: M-0003
  Type: rule
  Summary: Plans are step/checkpoint based and must not depend on real-world calendar dates.
  Affects: planning, STATE.yaml, PLAN.yaml
  References: `.crewbeectxt/PROJECT.md`

- ID: M-0004
  Type: decision
  Summary: Store scaffold source documents under `templates/crewbeectxt-template/`; reserve `.crewbeectxt/` for production project context workspaces.
  Affects: templates, scaffold, documentation
  References: `.crewbeectxt/DECISIONS.md#d-0004`

- ID: M-0005
  Type: discovery
  Summary: The runtime direction is OpenCode + CrewBee plug-and-play with prepare/search/finalize_request and maintainer-delegated scaffold work.
  Affects: CLI, API, tests, planning
  References: `.crewbeectxt/observations/CP-0003.md`

- ID: M-0008
  Type: rule
  Summary: Directory migration is not a product feature; projects should initialize and use `.crewbeectxt/` directly.
  Affects: scaffold, CLI, docs
  References: `.crewbeectxt/observations/CP-0007.md`

- ID: M-0009
  Type: discovery
  Summary: Implementation is being converted to TypeScript with small object-oriented classes coordinated by `ProjectContextService`.
  Affects: src, build, tests, package
  References: `.crewbeectxt/observations/CP-0008.md`

- ID: M-0006
  Type: rule
  Summary: Framework design and implementation must follow the minimalism principle; add complexity only when it directly reduces agent context cost or prevents a concrete safety problem.
  Affects: architecture, implementation, CrewBee integration
  References: `.crewbeectxt/DECISIONS.md#d-0005`

- ID: M-0007
  Type: discovery
  Summary: Minimalism pass removed template double sources and unused schemas; CrewBee bridge is limited to capsule plus prepare/search/finalize_request.
  Affects: scaffold, package, build, CrewBee integration
  References: `.crewbeectxt/observations/CP-0005.md`

- ID: M-0010
  Type: decision
  Summary: Do not expose `project_context_read`; main agents request prepare/search/finalize_request and Context Maintainer handles scaffold structure.
  Affects: CrewBee integration, prompt, tool surface
  References: `docs/zh-CN/PROJECT_GUIDE.md`

- ID: M-0011
  Type: decision
  Summary: `crewbee-project-context` is a sibling OpenCode plugin with root `opencode-plugin.mjs`, hidden maintainer, three tools, and CrewBee-style user-level install/doctor flow.
  Affects: package, OpenCode plugin loading, install, doctor
  References: `.crewbeectxt/observations/CP-0013.md`

- ID: M-0012
  Type: rule
  Summary: The private Project Context workspace must be invisible to the main Agent through prompt/capsule text, tool args, and non-maintainer tool outputs; access goes through prepare/search/finalize.
  Affects: OpenCode hooks, capsule, tool guard, output redaction
  References: `.crewbeectxt/observations/CP-0014.md`
