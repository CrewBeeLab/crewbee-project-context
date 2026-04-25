# Internal Development Guide

## Repository status

This repository is initialized as a dependency-free Node.js ESM package. The first implementation favors verifiability and stable module boundaries over feature depth.

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
4. update `.crewbee/STATE.yaml` and `.crewbee/HANDOFF.md` if project state materially changed;
5. add a memory or decision only for high-signal durable information.

## Coding conventions

- Prefer the smallest design that satisfies the current acceptance criteria.
- Keep the package dependency-light.
- Do not introduce abstractions before at least one real caller needs them.
- Keep file-system writes explicit and conservative.
- Do not read outside the project root for context operations.
- Do not store secrets in `.crewbee/`.
- Do not duplicate long canonical docs into `.crewbee/`; reference `docs/` instead.
- Keep `.crewbee/IMPLEMENTATION.md` aligned with the actual code.
- Keep scaffold source documents under `templates/crewbee-template/`; reserve `.crewbee/` for production project context workspaces.

## Module boundaries

- `core` contains shared primitives only.
- `scaffold` owns template initialization and validation.
- `store` owns path safety and file access.
- `primer` owns context compression.
- `search` owns local context retrieval.
- `update` owns safe state/handoff/memory/decision updates.
- `finalize` owns session-end updates.
- `integrations/crewbee` owns optional CrewBee-facing adapters.

## Release notes discipline

For each meaningful implementation checkpoint, create or update:

- `.crewbee/observations/CP-xxxx.md`
- `.crewbee/MEMORY_INDEX.md` when durable memory is created
- `.crewbee/DECISIONS.md` when architecture/product decisions change
