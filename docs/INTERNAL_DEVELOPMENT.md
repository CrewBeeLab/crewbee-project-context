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
4. update `.crewbeectxt/STATE.yaml` and `.crewbeectxt/HANDOFF.md` if project state materially changed;
5. add a memory or decision only for high-signal durable information.

## Coding conventions

- Prefer the smallest design that satisfies the current acceptance criteria.
- Keep the package dependency-light.
- Do not introduce abstractions before at least one real caller needs them.
- Keep file-system writes explicit and conservative.
- Do not read outside the project root for context operations.
- Do not store secrets in `.crewbeectxt/`.
- Do not duplicate long canonical docs into `.crewbeectxt/`; reference `docs/` instead.
- Keep `.crewbeectxt/IMPLEMENTATION.md` aligned with the actual code.
- Keep scaffold source documents under `templates/crewbeectxt-template/`; reserve `.crewbeectxt/` for production project context workspaces.

## Module boundaries

- `core` contains shared primitives only.
- `workspace` owns `.crewbeectxt` paths, bootstrap, doctor, and file access.
- `indexer` owns lightweight scaffold parsing.
- `capsule` owns Context Capsule and Task Context Brief compression.
- `maintainer` owns internal search/update execution and safe patching.
- `service` owns the object-oriented facade that coordinates modules.
- `integrations/crewbee` owns optional library bridge compatibility.
- `integrations/opencode` owns the real OpenCode plugin adapter, hidden maintainer config hook, tools, system transform, and task guard.
- `cli` is internal/debug/CI oriented, not the product user flow.

## Release notes discipline

For each meaningful implementation checkpoint, create or update:

- `.crewbeectxt/observations/CP-xxxx.md`
- `.crewbeectxt/MEMORY_INDEX.md` when durable memory is created
- `.crewbeectxt/DECISIONS.md` when architecture/product decisions change
