# Architecture

## System map

```text
.crewbee/ files
  -> ProjectContextStore
  -> ContextIndexer
  -> ContextPrimerBuilder
  -> ContextSearch
  -> ContextUpdater / SessionFinalizer
  -> CLI / TypeScript API
  -> CrewBee Integration Bridge
```

## Module responsibilities

- `src/core/`: constants, budgets, errors, shared types.
- `src/workspace/`: `.crewbee` paths, bootstrap, doctor, file-system reads and controlled writes.
- `src/indexer/`: lightweight extraction from state/plan/memory/handoff files.
- `src/capsule/`: low-token Context Capsule / Task Context Brief rendering.
- `src/maintainer/`: internal Context Maintainer, search, safe patching, finalize request handling.
- `src/integrations/crewbee/`: optional CrewBee/OpenCode extension, prompt fragment, tool definitions, handlers, internal-agent metadata.
- `src/service/`: object-oriented ProjectContextService facade.
- `src/cli/`: `crewbee-context` command-line interface.

## Key invariants

- `.crewbee/` is the default context directory.
- CrewBee Project Context can run standalone.
- CrewBee integration remains optional.
- Primer injection is compact; full docs are read on demand.
- Writes to project state are explicit and conservative.
- Minimalism is a hard design invariant: prefer plain files, small APIs, no background runtime, and no unused abstraction.

## Data flow

```text
detect(root)
  -> validate required context files
  -> parse state/plan/handoff/memory
  -> build primer
  -> agent reads/searches as needed
  -> finalize writes handoff/state/observation when needed
```
