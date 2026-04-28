# Architecture

## System map

```text
.crewbee/.prjctxt/ files
  -> ProjectContextStore
  -> ContextIndexer
  -> ContextPrimerBuilder
  -> ContextSearch
  -> ContextUpdater / SessionFinalizer
  -> internal service / diagnostic CLI
  -> CrewBee compatibility bridge
  -> OpenCode plugin adapter
```

## Module responsibilities

- `src/core/`: constants, budgets, errors, shared types.
- `src/workspace/`: `.crewbee/.prjctxt` paths, bootstrap, doctor, file-system reads and controlled writes.
- `src/indexer/`: lightweight extraction from state/plan/memory/handoff files.
- `src/capsule/`: low-token Context Capsule / Task Context Brief rendering.
- `src/maintainer/`: internal Context Maintainer service, search, safe patching, finalize handling.
- `src/integrations/crewbee/`: compatibility bridge, prompt fragment, tool definitions, handlers, internal-agent metadata.
- `src/integrations/opencode/`: real OpenCode plugin adapter, hidden maintainer config hook, tools, system transform, task guard, subsession runner.
- `src/service/`: object-oriented ProjectContextService facade.
- `src/cli/`: internal doctor/primer diagnostic entrypoint; not a published product CLI.

## Key invariants

- `.crewbee/.prjctxt/` is the product context directory.
- CrewBee Project Context can run standalone.
- CrewBee integration remains optional.
- Primer injection is compact; full docs are read on demand.
- Writes to project state are explicit, conservative, and validated after finalize.
- OpenCode plugin does not use `experimental.session.compacting`.
- Minimalism is a hard design invariant: prefer plain files, small APIs, no background runtime, and no unused abstraction.

## Data flow

```text
OpenCode plugin runtime
  -> inject compact prompt fragment
  -> expose prepare/search/finalize only
  -> call hidden project-context-maintainer through subsession
  -> validate required context files
  -> parse state/plan/handoff/memory
  -> build capsule / task brief
  -> maintainer searches context as needed
  -> finalize writes handoff/state/observation and runs doctor
```
