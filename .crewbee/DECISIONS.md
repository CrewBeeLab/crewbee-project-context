# Decisions

## D-0001

- Status: accepted
- Context: The product is positioned as a CrewBee-native project context layer and needs one clear production context directory name.
- Decision: Use `.crewbee/` as the only production project context workspace directory. Do not implement directory migration as a product feature.
- Consequences:
  - Pros: Clear product identity, stable CrewBee detection target, less ambiguity with other agent tools.
  - Cons: Less generic naming for non-CrewBee users.

## D-0002

- Status: accepted
- Context: Project context should help CrewBee agents recover context, but CrewBee Core should remain focused on team projection and runtime integration.
- Decision: Build this repository as standalone `@crewbee/project-context`; CrewBee integrates it optionally.
- Consequences:
  - Pros: Lower coupling, independent release/testing, usable outside CrewBee.
  - Cons: Integration bridge must be maintained across package boundaries.

## D-0003

- Status: accepted
- Context: A heavy memory database or automatic transcript capture would increase operational complexity early.
- Decision: MVP uses version-controlled Markdown/YAML-like files plus a compact primer and on-demand read/search.
- Consequences:
  - Pros: Transparent, reviewable, easy to bootstrap.
  - Cons: Retrieval is initially simpler than database-backed memory systems.

## D-0004

- Status: accepted
- Context: The repository needs both its own production project context and scaffold source documents for initializing other projects.
- Decision: Keep this repository's live context in `.crewbee/`, but store scaffold source documents under `templates/crewbee-template/` so they are explicitly marked as templates during development.
- Consequences:
  - Pros: Avoids confusing source templates with production context workspaces.
  - Cons: Template paths differ from the generated runtime directory name.

## D-0005

- Status: accepted
- Context: Project Context can easily become over-engineered if it grows into a memory database, runtime, or broad integration framework.
- Decision: Treat minimalism as a hard design and implementation principle. Prefer plain files, explicit CLI/API flows, compact prompt fragments, and adapter-level CrewBee integration. Add complexity only when it directly reduces agent context cost or addresses a concrete safety issue.
- Consequences:
  - Pros: Keeps the tool transparent, easy to verify, and cheap for agents to use.
  - Cons: Some advanced automation must wait until a real workflow proves it is necessary.
