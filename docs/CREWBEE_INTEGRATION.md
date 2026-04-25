# CrewBee Integration Design

## Principle

CrewBee should integrate CrewBee Project Context, but should not turn it into a core-coupled module.

The integration must be minimal: detect `.crewbee/`, inject one compact primer, and expose only the smallest useful tool surface. Do not add a second runtime, background memory manager, complex sync daemon, or CrewBee Core contract dependency.

```text
CrewBee Core:
  no hard knowledge of .crewbee file details

CrewBee Adapter / Plugin:
  optionally loads @crewbee/project-context

Project Context:
  exposes prepare, search, and finalize_request tools through the CrewBee/OpenCode runtime extension
```

## Runtime flow

```text
OpenCode session starts
  -> CrewBee plugin loads
  -> CrewBee identifies projected agent/team
  -> CrewBee detects project root
  -> CrewBee calls @crewbee/project-context.detect(root)
  -> if .crewbee exists:
       build Context Primer
       inject primer into system prompt
       register project_context_prepare/search/finalize_request tools
  -> Agent uses prepare before broad project-context exploration
  -> Agent performs task
  -> Agent triggers finalize_request when state materially changes
```

## Prompt injection

CrewBee should inject only a compact Runtime Rule + Context Capsule, not full documents.

The capsule contains:

- project identity;
- active step/status;
- blockers;
- exact next actions;
- high-signal memory;
- available tools.

## Suggested CrewBee config

```json
{
  "projectContext": {
    "enabled": true,
    "primerBudgetTokens": 1000,
    "autoInjectPrimer": true,
    "autoFinalize": "manual",
    "registerTools": true,
    "writeMode": "tool-confirmed"
  }
}
```

## Suggested tools

```text
project_context_prepare
project_context_search
project_context_finalize_request
```

Do not expose `project_context_read`; scaffold file selection is handled by the internal Context Maintainer.

## Minimal shared agent rule

Avoid repeating a long Project Context policy in every agent. CrewBee can add one compact shared rule:

```text
When Project Context is available, use project_context_prepare before broad project-context exploration. Use project_context_search only when prepared context is insufficient. Do not read or edit .crewbee files directly. After material changes, call project_context_finalize_request with completed work, changed files, verification, blockers, and next actions.
```

## Non-goals

- Do not make `.crewbee/` mandatory for CrewBee.
- Do not move scaffold templates into CrewBee Core.
- Do not break existing CrewBee team projection when project context is absent.
- Do not auto-write project state without explicit tool/action boundaries in the MVP.
- Do not introduce background indexing, vector search, or a separate runtime for the integration MVP.
