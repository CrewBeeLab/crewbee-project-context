# CrewBee Project Context Project Design

## 1. Project positioning

CrewBee Project Context is the project-context layer for Agent Coding. It keeps the information that agents repeatedly need across sessions in a compact, explicit, version-controlled `.crewbeectxt/` workspace.

It is not a heavy memory database, not a multi-agent runtime, and not CrewBee Core. It is a standalone package that CrewBee can optionally integrate.

## 1.1 Minimalism principle

The framework design and implementation must follow a strict minimalism principle:

> Build the smallest transparent context layer that lets agents recover project state and continue work safely.

This means:

- no dependency unless it removes more complexity than it adds;
- no new file type unless Markdown/YAML-like files cannot express the state;
- no background worker while the runtime extension and internal service flows are sufficient;
- no database or vector index before plain files and local search are proven insufficient;
- no CrewBee Core coupling for a feature that can live in an adapter/plugin bridge;
- no abstraction layer, schema file, or generated artifact that is not used by at least one real command or integration path.

## 2. Problem

Agent coding sessions repeatedly pay high context cost to rediscover:

- what the project is for;
- which architecture decisions are already accepted;
- what has already been implemented;
- what is currently blocked;
- what the next planned step is;
- what changed in previous sessions.

Letting every new session rediscover those facts by reading the whole repository wastes tokens and increases the probability of inconsistent decisions.

## 3. Product answer

The repository owns a `.crewbeectxt/` workspace with high-signal project context and provides a minimal OpenCode plugin extension to:

1. prepare task-relevant project context;
2. search project context through a maintainer-controlled path;
3. request finalize/maintenance after material changes;
4. integrate with CrewBee/OpenCode without coupling to CrewBee Core.

## 4. Two-layer architecture

```text
crewbee-project-context
  -> .crewbeectxt workspace convention
  -> OpenCode plugin / hidden maintainer subagent / prepare / search / finalize

CrewBee
  -> Team-first agent framework
  -> OpenCode integration
  -> optional project context provider integration
```

There is no third standards repository. The context convention and implementation live together in this repository.

## 5. Context model

The context layer separates canonical human documentation from compact execution state.

```text
docs/       = durable human-facing design documents
.crewbeectxt/ = compact project-context execution view
templates/crewbeectxt-template/ = source templates used to create production .crewbeectxt/ workspaces
```

`.crewbeectxt/` should be small enough for the hidden maintainer to read selectively, but structured enough to replace ad hoc session memory.

During development, template documents must live in a directory explicitly marked as a template. The runtime/production directory name remains `.crewbeectxt/`.

## 6. Core files

| File | Purpose |
| --- | --- |
| `.crewbeectxt/QUICKSTART.md` | Agent entry instructions and read order. |
| `.crewbeectxt/PROJECT.md` | Project identity, scope, constraints, quality bar. |
| `.crewbeectxt/ARCHITECTURE.md` | Stable system structure and invariants. |
| `.crewbeectxt/IMPLEMENTATION.md` | Current real implementation snapshot. |
| `.crewbeectxt/PLAN.yaml` | Date-free plan organized by cycles/steps/checkpoints. |
| `.crewbeectxt/STATE.yaml` | Current active cycle, active step, blockers, next actions. |
| `.crewbeectxt/HANDOFF.md` | Next-session entry point. |
| `.crewbeectxt/MEMORY_INDEX.md` | High-signal memory index. |
| `.crewbeectxt/DECISIONS.md` | Lightweight architecture decision records. |
| `.crewbeectxt/REFERENCES.md` | Canonical docs and external references. |

## 7. Functional modules

```text
src/core/          shared constants, budgets, errors, types
src/workspace/     .crewbeectxt paths, bootstrap, doctor, filesystem access
src/indexer/       extraction from project context files
src/capsule/       low-token Context Capsule and Task Context Brief generation
src/maintainer/    prepare/search/finalize execution and safe patching
src/integrations/  CrewBee bridge and OpenCode plugin adapter, prompt fragments, tools, hidden maintainer metadata
src/cli/           internal debug/doctor CLI
templates/crewbeectxt-template/ scaffold source documents copied into target .crewbeectxt/ workspaces
```

## 8. MVP scope

The MVP intentionally uses plain files and zero runtime dependencies:

- Markdown + YAML-like text files;
- no SQLite;
- no vector database;
- no background worker;
- no UI;
- no automatic full chat capture.

This keeps the tool easy to embed, review, and trust. The intended runtime surface is prepare/search/finalize, with scaffold reads and writes delegated to a hidden OpenCode Context Maintainer subagent behind tools.

## 9. Development roadmap

Development is step-based, not calendar-based.

### S1: Repository initialization

- Rename/reposition to `crewbee-project-context`.
- Add `.crewbeectxt/` workspace and documentation.
- Add dependency-free internal CLI/service skeleton.

### S2: Scaffold MVP

- lazy bootstrap of `.crewbeectxt/`
- internal doctor
- `.crewbeectxt/` as the only production context directory name.

### S3: Primer MVP

- Build a budgeted context primer from state, plan, handoff, decisions, and memory.

### S4: Internal Read/Search MVP

- Safe internal `.crewbeectxt/` reads.
- Maintainer-controlled local text search over context files.

### S5: Update/Finalize MVP

- Safe state/handoff/memory updates.
- Session observation writer.

### S6: Minimal CrewBee/OpenCode integration

- Optional prompt primer injection.
- Minimal `project_context_prepare/search/finalize` tool bridge.
- No behavior change when `.crewbeectxt/` is absent.
- No CrewBee Core contract changes.

## 10. Completion criteria

- Agents can restore project context without reading the whole repository first.
- Context files remain small, structured, and version-controlled.
- CrewBee can integrate the package without making it a core dependency.
- Validation catches missing files and basic consistency errors.
- Build, diagnostics, and tests pass in a clean checkout.
