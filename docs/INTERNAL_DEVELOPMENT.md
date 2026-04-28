# Internal Development Guide

## Repository status

This repository is implemented as a TypeScript package with a small object-oriented service structure. The implementation favors verifiability, minimal abstractions, and stable module boundaries over feature depth.

## Commands

```bash
npm run diagnostics
npm run typecheck
npm test
npm run build
npm run doctor
npm run primer
```

## Quality bar

Before declaring a change complete:

1. run diagnostics;
2. run tests;
3. run build/typecheck;
4. update `.crewbee/.prjctxt/STATE.yaml` and `.crewbee/.prjctxt/HANDOFF.md` if project state materially changed;
5. add a memory or decision only for high-signal durable information.

## Coding conventions

- Prefer the smallest design that satisfies the current acceptance criteria.
- Keep the package dependency-light.
- Do not introduce abstractions before at least one real caller needs them.
- Keep file-system writes explicit and conservative.
- Do not read outside the project root for context operations.
- Do not store secrets in `.crewbee/.prjctxt/`.
- Do not duplicate long canonical docs into `.crewbee/.prjctxt/`; reference `docs/` instead.
- Keep `.crewbee/.prjctxt/IMPLEMENTATION.md` aligned with the actual code.
- Keep scaffold source documents under `templates/prjctxt-template/`; reserve `.crewbee/.prjctxt/` for production project context workspaces.

## Module boundaries

- `core` contains shared primitives only.
- `workspace` owns `.crewbee/.prjctxt` paths, bootstrap, doctor, and file access.
- `indexer` owns lightweight scaffold parsing.
- `capsule` owns Context Capsule and Task Context Brief compression.
- `maintainer` owns maintainer-driven search support; initialization and update jobs are orchestrated by the OpenCode runtime and executed by the hidden maintainer.
- `service` owns the object-oriented facade that coordinates modules.
- `integrations/crewbee` owns optional library bridge compatibility.
- `integrations/opencode` owns the real OpenCode plugin adapter, hidden maintainer config hook, search tool, first-start scaffold initialization, auto-prepare system transform, auto-update event/chat/tool hooks, output redaction, and task guard.
- `cli` is internal/debug/CI oriented, not the product user flow.

## Release notes discipline

For each meaningful implementation checkpoint, create or update:

- `.crewbee/.prjctxt/observations/CP-xxxx.md`
- `.crewbee/.prjctxt/MEMORY_INDEX.md` when durable memory is created
- `.crewbee/.prjctxt/DECISIONS.md` when architecture/product decisions change
