# Project

## Project ID

crewbee-project-context

## Project Name

CrewBee Project Context

## Objective

Provide a lightweight, transparent project-context layer for Agent Coding and CrewBee/OpenCode projects. The package owns the private Project Context workspace convention plus a minimal OpenCode plugin that can bootstrap, prepare, search, and automatically maintain compact project knowledge without making CrewBee Core depend on the scaffold.

## Constraints

- Follow the minimalism principle: add files, dependencies, concepts, abstractions, or runtime surfaces only when they reduce future agent context cost or prevent a concrete safety problem.
- Prefer plain Markdown/YAML-like files, local text search, and adapter-level integration over databases, vector infrastructure, background daemons, or CrewBee Core coupling.
- Keep the main-agent runtime surface small: automatic init/prepare/update plus one rare-fallback search tool.
- Keep the private Project Context workspace out of main-agent prompts, direct tool arguments, capsule metadata, non-maintainer tool output, and visible tool schemas.
- Do not store secrets in the Project Context workspace; deny obvious secret files to the hidden maintainer.

## Quality Bar

- `npm run diagnostics`, `npm test`, and `npm run doctor` are the primary verification commands.
- Product behavior must avoid exposing private scaffold paths to primary agents and tests should enforce this boundary.
- Runtime update failures are auxiliary/best-effort and must not block the primary development task.
