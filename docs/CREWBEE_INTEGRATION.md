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
  exposes detect, validate, primer, read, search, update, finalize APIs
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
       register project_context_* tools
  -> Agent uses read/search before broad code exploration
  -> Agent performs task
  -> Agent/user triggers finalize when state materially changes
```

## Prompt injection

CrewBee should inject only a compact primer, not full documents.

The primer contains:

- project identity;
- active step/status;
- blockers;
- exact next actions;
- high-signal memory;
- read order;
- available tools;
- update discipline.

## Suggested CrewBee config

```json
{
  "projectContext": {
    "enabled": true,
    "contextDir": ".crewbee",
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
project_context_read
project_context_search
project_context_finalize
```

`project_context_update` may be added later only if a real integration workflow needs structured writes beyond finalize.

## Minimal shared agent rule

Avoid repeating a long Project Context policy in every agent. CrewBee can add one compact shared rule:

```text
When Project Context is available, inspect the injected Context Primer before broad code exploration. Prefer project_context_search/read for prior architecture, implementation state, plan, decisions, risks, and handoff records. Update .crewbee state only when project state materially changes.
```

## Non-goals

- Do not make `.crewbee/` mandatory for CrewBee.
- Do not move scaffold templates into CrewBee Core.
- Do not break existing CrewBee team projection when project context is absent.
- Do not auto-write project state without explicit tool/action boundaries in the MVP.
- Do not introduce background indexing, vector search, or a separate runtime for the integration MVP.
