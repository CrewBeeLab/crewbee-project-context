# CrewBee + Project Context Integration Design

## Principle

`crewbee` and `crewbee-project-context` are sibling OpenCode plugins.

```text
crewbee
  -> Team / Agent projection, delegation, runtime binding

crewbee-project-context
  -> .crewbeectxt project context, hidden maintainer, prepare/search/finalize tools
```

Project Context does not enter CrewBee Core, does not become a visible CrewBee Team member, and does not use CrewBee `delegate_task`.

## Plugin order

Recommended OpenCode config:

```json
{
  "plugin": ["crewbee", "crewbee-project-context"]
}
```

CrewBee projects visible agents first. Project Context then injects hidden `project-context-maintainer`, registers tools, and adds a task deny guard so primary agents do not call the maintainer directly.

## Main-agent surface

Visible to CrewBee agents:

```text
project_context_prepare
project_context_search
project_context_finalize
```

Not visible:

```text
project_context_read
.crewbeectxt file menu
project-context-maintainer prompt
maintainer subsession id/status
```

## Hooks

Project Context uses only:

```text
config
experimental.chat.system.transform
```

It intentionally does not use `experimental.session.compacting`; compaction output already carries necessary session context and Project Context should remain passive until a tool is called.

## Runtime rule

Injected rule is compact:

```text
Project Context is available through crewbee-project-context.
Use project_context_prepare when prior project architecture, implementation state, plan, or decisions may affect the task.
Use project_context_search only when prepared context is insufficient.
After material changes, call project_context_finalize with summary, changed files, verification, blockers, and next actions.
```

No rule forbids the CrewBee main agent from editing `.crewbee/` or business files. Project Context avoids attention cost by hiding `.crewbeectxt/` details, not by constraining CrewBee's normal permissions.

## Maintainer execution

Tool call flow:

```text
main CrewBee agent calls project_context_* tool
  -> crewbee-project-context plugin creates OpenCode subsession
  -> hidden project-context-maintainer runs with restricted permissions
  -> maintainer reads/searches/updates .crewbeectxt/**
  -> plugin runs doctor for finalize
  -> tool returns final compact result
```

No status, cancel, or streaming interface is exposed for maintainer jobs in V1.

## Non-goals

- No compaction hook.
- No project_context_read.
- No visible maintainer agent.
- No CrewBee Core contract change.
- No modification to primary agent edit/write permissions.
- No SQLite/vector database/background sync daemon.
