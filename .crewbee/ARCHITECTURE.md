# Architecture

## System map

```text
.crewbee/ files
  -> ProjectContextStore
  -> ContextIndexer
  -> ContextPrimerBuilder
  -> ContextSearch
  -> ContextUpdater / SessionFinalizer
  -> CLI / JavaScript API
  -> CrewBee Integration Bridge
```

## Module responsibilities

- `src/core/`: constants, errors, path safety helpers.
- `src/scaffold/`: initialization, templates, validation.
- `src/store/`: file-system reads and controlled writes.
- `src/indexer/`: lightweight extraction from state/plan/memory/handoff files.
- `src/primer/`: low-token context primer rendering.
- `src/search/`: local text search over `.crewbee/` files.
- `src/finalize/`: session summaries and observation writing.
- `src/integrations/crewbee/`: optional CrewBee-facing prompt/tool bridge.
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
