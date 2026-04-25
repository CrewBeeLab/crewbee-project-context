# CrewBee Project Context

CrewBee Project Context is a lightweight project context layer for Agent Coding.

It stores high-signal project knowledge in a `.crewbeectxt/` workspace, including project identity, architecture, implementation snapshot, plan, current state, handoff, decisions, and memory index.

It helps CrewBee agents restore project context with minimal attention cost, while delegating scaffold maintenance to a Project Context Maintainer instead of the main coding agent.

It integrates with OpenCode + CrewBee as a sibling OpenCode plugin. The CLI is kept as an internal debugging and CI utility, not as the primary user workflow.

> CrewBee should integrate it, but not be core-coupled to it.

## Minimalism principle

Design and implementation must stay minimal. Add a concept, file, command, dependency, abstraction, or integration point only when it directly reduces future agent context cost or prevents a concrete safety problem.

Default choices:

- plain files over databases;
- local text search over vector infrastructure;
- automatic plugin/runtime integration over manual user CLI steps;
- small prompt fragments over large injected documents;
- adapter-level CrewBee integration over CrewBee Core coupling.

## Positioning

```text
crewbee-project-context
  = project context layer / document scaffold / context primer / search / handoff / finalize

CrewBee
  = Team-first Agent framework / OpenCode adapter / Agent projection / runtime integration
```

This repository owns the `.crewbeectxt/` convention and the tools that read, validate, summarize, search, and safely update it. CrewBee can consume the tools, but CrewBee Core does not depend on scaffold details.

## MVP capabilities

- Detect or lazily bootstrap a `.crewbeectxt/` context workspace.
- Generate a low-token Runtime Rule + Context Capsule.
- Expose only `project_context_prepare`, `project_context_search`, and `project_context_finalize` to the main agent.
- Delegate scaffold reading and maintenance to a hidden OpenCode Context Maintainer subagent behind those tools.
- Avoid exposing scaffold file structure through `project_context_read`.
- Integrate as an OpenCode plugin and do not use `experimental.session.compacting`.

## Quick start

```bash
npm install
npm run diagnostics
npm test
npm run build
npm run pack:local
npm run install:local:user
npm run doctor
```

In product usage, install `crewbee` and `crewbee-project-context` as sibling OpenCode plugins and start OpenCode. Recommended OpenCode plugin order is:

```json
{
  "plugin": ["crewbee", "crewbee-project-context"]
}
```

Project Context detects `.crewbeectxt/`, injects a compact capsule, and registers the minimal tools automatically. The install CLI targets the OpenCode user-level plugin workspace; scaffold init/read/update is not exposed as the main user workflow.

Useful development-only commands:

```bash
npm run primer
node dist/src/cli/main.js context:doctor
```

## `.crewbeectxt/` workspace

```text
.crewbeectxt/
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

The workspace is a compact execution view for agents, not a replacement for canonical long-form docs. Use `docs/` for durable human-facing design material and `.crewbeectxt/` for compressed execution state.

## Template directory rule

During development, scaffold source documents live under `templates/crewbeectxt-template/` to make it explicit that they are templates. The production context directory created inside a target project is always `.crewbeectxt/`.

## Documentation

- [中文指南：项目框架、实现、安装与使用](docs/zh-CN/PROJECT_GUIDE.md)
- [Project design](docs/PROJECT_DESIGN.md)
- [CrewBee integration](docs/CREWBEE_INTEGRATION.md)
- [Internal development guide](docs/INTERNAL_DEVELOPMENT.md)
- [Claude-mem inspired notes](docs/CLAUDE_MEM_INSIGHTS.md)

## Current implementation status

This version uses a TypeScript implementation with a small object-oriented service structure and an OpenCode plugin adapter. It ships a root `opencode-plugin.mjs` package entrypoint, hidden `project-context-maintainer` config injection, three OpenCode tools, direct Task maintainer guard, and CrewBee-style user-level install / doctor flow. `.crewbeectxt/` is the product context directory.
