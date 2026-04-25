# CrewBee Project Context

CrewBee Project Context is a lightweight project context layer for Agent Coding.

It stores high-signal project knowledge in a `.crewbee/` workspace, including project identity, architecture, implementation snapshot, plan, current state, handoff, decisions, and memory index.

It helps coding agents restore project context at session start with minimal tokens, search prior decisions before broad code exploration, and write back compact handoff records at session end.

It is designed to work standalone through the `crewbee-context` CLI and integrate seamlessly with CrewBee as an optional project-context provider.

> CrewBee should integrate it, but not be core-coupled to it.

## Minimalism principle

Design and implementation must stay minimal. Add a concept, file, command, dependency, abstraction, or integration point only when it directly reduces future agent context cost or prevents a concrete safety problem.

Default choices:

- plain files over databases;
- local text search over vector infrastructure;
- explicit CLI/API calls over background automation;
- small prompt fragments over large injected documents;
- adapter-level CrewBee integration over CrewBee Core coupling.

## Positioning

```text
crewbee-project-context
  = project context layer / document scaffold / context primer / search / handoff / finalize

CrewBee
  = Team-first Agent framework / OpenCode adapter / Agent projection / runtime integration
```

This repository owns the `.crewbee/` convention and the tools that read, validate, summarize, search, and safely update it. CrewBee can detect and consume this context, but CrewBee Core does not need to depend on the details of the scaffold.

## MVP capabilities

- Initialize a `.crewbee/` context workspace.
- Migrate an old `.agent/` context workspace to `.crewbee/`.
- Validate required project-context files.
- Generate a low-token context primer for Agent session start.
- Read and search project-context files before broad code exploration.
- Safely update state/handoff/memory/decision files.
- Finalize a session by writing a checkpoint observation and refreshing state/handoff.
- Provide an optional integration bridge for CrewBee.

## Quick start

```bash
npm install
npm run diagnostics
npm test
npm run build
node src/cli/main.js primer
```

Initialize a target project:

```bash
crewbee-context init --project-name "My Project" --project-id my-project
```

Generate a context primer:

```bash
crewbee-context primer --budget 1000
```

Validate context consistency:

```bash
crewbee-context doctor
```

Migrate an older scaffold:

```bash
crewbee-context migrate --from .agent --to .crewbee
```

Finalize a session:

```bash
crewbee-context finalize --summary "Implemented context update flow" --verification "npm test passed" --next-action "Continue CrewBee integration"
```

## `.crewbee/` workspace

```text
.crewbee/
  QUICKSTART.md
  PROJECT.md
  ARCHITECTURE.md
  IMPLEMENTATION.md
  PLAN.yaml
  STATE.yaml
  HANDOFF.md
  MEMORY_INDEX.md
  DECISIONS.md
  REFERENCES.md
  config.yaml
  observations/
  cache/
```

The workspace is a compact execution view for agents, not a replacement for canonical long-form docs. Use `docs/` for durable human-facing design material and `.crewbee/` for compressed execution state.

## Template directory rule

During development, scaffold source documents live under `templates/crewbee-template/` to make it explicit that they are templates. The production context directory created inside a target project is always `.crewbee/`.

## Documentation

- [Project design](docs/PROJECT_DESIGN.md)
- [CrewBee integration](docs/CREWBEE_INTEGRATION.md)
- [Internal development guide](docs/INTERNAL_DEVELOPMENT.md)
- [Claude-mem inspired notes](docs/CLAUDE_MEM_INSIGHTS.md)

## Current implementation status

This initial version is intentionally small and dependency-free. It provides a working CLI/API skeleton, template initialization, migration, context validation, primer generation, basic text search, safe update, finalize, and repository-local verification scripts. The module boundaries mirror the planned TypeScript architecture so the project can evolve without changing product shape.
