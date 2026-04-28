# CrewBee Project Context Project Design

## 1. Project positioning

CrewBee Project Context is the project-context layer for Agent Coding. It keeps the information that agents repeatedly need across sessions in a compact, explicit, version-controlled `.crewbee/.prjctxt/` workspace.

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

The repository owns a `.crewbee/.prjctxt/` workspace with high-signal project context and provides a minimal OpenCode plugin extension to:

1. initialize a missing scaffold on first project startup;
2. prepare task-relevant project context automatically;
3. search project context through a maintainer-controlled path;
4. maintain context automatically after material changes;
5. integrate with CrewBee/OpenCode without coupling to CrewBee Core.

## 4. Two-layer architecture

```text
crewbee-project-context
  -> .crewbee/.prjctxt workspace convention
  -> OpenCode plugin / hidden maintainer subagent / auto init / auto prepare / optional search / auto update

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
.crewbee/.prjctxt/ = compact project-context execution view
templates/crewbeectxt-template/ = source templates used to create production .crewbee/.prjctxt/ workspaces
```

`.crewbee/.prjctxt/` should be small enough for the hidden maintainer to read selectively, but structured enough to replace ad hoc session memory.

During development, template documents must live in a directory explicitly marked as a template. The runtime/production directory name remains `.crewbee/.prjctxt/`.

## 6. Core files

| File | Purpose |
| --- | --- |
| `.crewbee/.prjctxt/QUICKSTART.md` | Agent entry instructions and read order. |
| `.crewbee/.prjctxt/PROJECT.md` | Project identity, scope, constraints, quality bar. |
| `.crewbee/.prjctxt/ARCHITECTURE.md` | Stable system structure and invariants. |
| `.crewbee/.prjctxt/IMPLEMENTATION.md` | Current real implementation snapshot. |
| `.crewbee/.prjctxt/PLAN.yaml` | Date-free plan organized by cycles/steps/checkpoints. |
| `.crewbee/.prjctxt/STATE.yaml` | Current active cycle, active step, blockers, next actions. |
| `.crewbee/.prjctxt/HANDOFF.md` | Next-session entry point. |
| `.crewbee/.prjctxt/MEMORY_INDEX.md` | High-signal memory index. |
| `.crewbee/.prjctxt/DECISIONS.md` | Lightweight architecture decision records. |
| `.crewbee/.prjctxt/REFERENCES.md` | Canonical docs and external references. |

## 7. Functional modules

```text
src/core/          shared constants, budgets, errors, types
src/workspace/     .crewbee/.prjctxt paths, bootstrap, doctor, filesystem access
src/indexer/       extraction from project context files
src/capsule/       low-token Context Capsule and Task Context Brief generation
src/maintainer/    maintainer-driven context search support
src/integrations/  CrewBee bridge and OpenCode plugin adapter, prompt fragments, tools, hidden maintainer metadata
src/cli/           internal debug/doctor CLI
templates/crewbeectxt-template/ scaffold source documents copied into target .crewbee/.prjctxt/ workspaces
```

## 8. MVP scope

The MVP intentionally uses plain files and zero runtime dependencies:

- Markdown + YAML-like text files;
- no SQLite;
- no vector database;
- no background worker;
- no UI;
- no automatic full chat capture.

This keeps the tool easy to embed, review, and trust. The intended visible runtime surface is only project_context_search, and it is a high-threshold fallback for blocking historical context gaps. Initialization is automatic when the scaffold framework is missing; prepare is automatic local I/O; update is automatic hidden-maintainer maintenance after material turns.

## 9. Development roadmap

Development is step-based, not calendar-based.

### S1: Repository initialization

- Rename/reposition to `crewbee-project-context`.
- Add `.crewbee/.prjctxt/` workspace and documentation.
- Add dependency-free internal CLI/service skeleton.

### S2: Scaffold MVP

- lazy bootstrap of `.crewbee/.prjctxt/`
- internal doctor
- `.crewbee/.prjctxt/` as the only production context directory name.

### S3: Primer MVP

- Build a budgeted context primer from state, plan, handoff, decisions, and memory.

### S4: Internal Read/Search MVP

- Safe internal `.crewbee/.prjctxt/` reads.
- Maintainer-controlled local text search over context files.

### S5: Auto update MVP

- Hidden maintainer update jobs after material turns.
- Runtime-managed session observations and handoff maintenance inside the private workspace.

### S6: Minimal CrewBee/OpenCode integration

- Automatic first-start scaffold creation when required framework files are missing.
- Hidden maintainer initialization job that reads docs, architecture/design notes, tests, package metadata, and main source implementation.
- Automatic prompt-time context prepare.
- Single visible `project_context_search` tool bridge.
- Automatic post-turn context update.
- No CrewBee Core contract changes.

## 10. Completion criteria

- Agents can restore project context without reading the whole repository first.
- Context files remain small, structured, and version-controlled.
- CrewBee can integrate the package without making it a core dependency.
- Validation catches missing files and basic consistency errors.
- Build, diagnostics, and tests pass in a clean checkout.
