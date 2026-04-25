# Project

## Project ID

crewbee-project-context

## Project Name

CrewBee Project Context

## Objective

Provide a lightweight project-context layer for Agent Coding. The package owns the `.crewbee/` workspace convention, CLI, API, templates, validation, primer generation, context search, handoff/finalize flow, and optional CrewBee integration bridge.

## In Scope

- `.crewbee/` scaffold specification.
- Context initialization and validation.
- Low-token context primer generation.
- Safe context read/search/update/finalize APIs.
- Optional CrewBee integration bridge.
- Documentation for humans and agents.

## Out of Scope

- CrewBee Core team/runtime implementation.
- Heavy memory database.
- Vector search.
- Background transcript capture.
- UI.
- Cross-repository global memory.

## Constraints

- Follow the minimalism principle for both framework design and implementation.
- Keep MVP dependency-free or dependency-light.
- Prefer plain files, explicit CLI/API calls, and adapter-level integration over background services or core coupling.
- Keep CrewBee integration optional.
- Prefer files that can be committed and reviewed.
- Do not store secrets.
- Do not use reality-calendar schedules for project plans.

## Quality Bar

- Diagnostics pass.
- Tests pass.
- Build/typecheck pass.
- `.crewbee/` context remains consistent with implementation.
