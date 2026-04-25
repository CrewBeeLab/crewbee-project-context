# Memory Index

- ID: M-0001
  Type: decision
  Summary: Use `.crewbee/` as the project context workspace instead of `.agent/`.
  Affects: scaffold, templates, CrewBee integration
  References: `.crewbee/DECISIONS.md#d-0001`

- ID: M-0002
  Type: decision
  Summary: Keep CrewBee Project Context standalone and let CrewBee integrate it optionally without core coupling.
  Affects: architecture, package boundaries
  References: `.crewbee/DECISIONS.md#d-0002`

- ID: M-0003
  Type: rule
  Summary: Plans are step/checkpoint based and must not depend on real-world calendar dates.
  Affects: planning, STATE.yaml, PLAN.yaml
  References: `.crewbee/PROJECT.md`

- ID: M-0004
  Type: decision
  Summary: Store scaffold source documents under `templates/crewbee-template/`; reserve `.crewbee/` for production project context workspaces.
  Affects: templates, scaffold, documentation
  References: `.crewbee/DECISIONS.md#d-0004`

- ID: M-0005
  Type: discovery
  Summary: The dependency-free MVP now covers init, migrate, doctor, primer, read/search, safe update, and finalize.
  Affects: CLI, API, tests, planning
  References: `.crewbee/observations/CP-0003.md`

- ID: M-0006
  Type: rule
  Summary: Framework design and implementation must follow the minimalism principle; add complexity only when it directly reduces agent context cost or prevents a concrete safety problem.
  Affects: architecture, implementation, CrewBee integration
  References: `.crewbee/DECISIONS.md#d-0005`

- ID: M-0007
  Type: discovery
  Summary: Minimalism pass removed template double sources and unused schemas; CrewBee bridge is limited to primer plus read/search/finalize.
  Affects: scaffold, package, build, CrewBee integration
  References: `.crewbee/observations/CP-0005.md`
