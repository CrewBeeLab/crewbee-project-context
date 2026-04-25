# Project

## Project ID

crewbee-project-context

## Project Name

CrewBee Project Context

## Objective

Provide a lightweight OpenCode plugin sidecar for CrewBee Agent Coding. The package owns the `.crewbeectxt/` workspace convention, templates, validation, capsule generation, context search, handoff/finalize flow, hidden maintainer subagent, and minimal OpenCode tools.

## In Scope

- `.crewbeectxt/` scaffold specification.
- Context initialization and validation.
- Low-token context primer generation.
- Minimal prepare/search/finalize runtime tools for main agents.
- Internal context read/update/finalize APIs for maintainer and diagnostics.
- OpenCode plugin adapter that can run alongside the CrewBee plugin.
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
- Prefer plain files, explicit tool calls, and adapter-level integration over background services or core coupling.
- Keep CrewBee integration optional.
- Prefer files that can be committed and reviewed.
- Do not store secrets.
- Do not use reality-calendar schedules for project plans.

## Quality Bar

- Diagnostics pass.
- Tests pass.
- Build/typecheck pass.
- `.crewbeectxt/` context remains consistent with implementation.
