# Decisions

## D-0001

- Status: accepted
- Context: The product is positioned as a CrewBee-native project context layer and needs one clear production context directory name.
- Decision: Use `.crewbee/.prjctxt/` as the only production project context workspace directory. Do not implement directory migration as a product feature.
- Consequences:
  - Pros: Clear product identity, stable CrewBee detection target, less ambiguity with other agent tools.
  - Cons: Less generic naming for non-CrewBee users.

## D-0002

- Status: accepted
- Context: Project context should help CrewBee agents recover context, but CrewBee Core should remain focused on team projection and runtime integration.
- Decision: Build this repository as standalone `crewbee-project-context`; CrewBee integrates it optionally as a sibling OpenCode plugin.
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
- Decision: Keep this repository's live context in `.crewbee/.prjctxt/`, but store scaffold source documents under `templates/prjctxt-template/` so they are explicitly marked as templates during development.
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

## D-0006

- Status: accepted
- Context: CrewBee already owns Agent Team projection and OpenCode runtime binding, while Project Context should own only engineering context memory and handoff state.
- Decision: Ship `crewbee-project-context` as a sibling OpenCode plugin with root `opencode-plugin.mjs`, hidden `project-context-maintainer`, automatic prepare/update, only `project_context_search` visible to the main Agent, and CrewBee-style user-level install / doctor flow.
- Consequences:
  - Pros: Keeps CrewBee Core decoupled, preserves main-agent permissions, and makes project context installation and validation operationally consistent with CrewBee.
  - Cons: A live OpenCode startup smoke test remains required before release confidence is complete.

## D-0007

- Status: superseded by D-0008
- Context: Prepare visibility must reassure Desktop/TUI users without polluting model history, and automatic update can change private context revisions immediately after a parent response.
- Decision: Prefer toast/status prepare display over chat messages, keep ignored no-reply prompt as fallback only, and suppress the parent session's next visible prepare after an automatic update completes.
- Consequences:
  - Pros: Reduces confusing prepare noise and avoids repeat visible prepare triggered only by private context maintenance.
  - Cons: Live Desktop validation is still needed for the exact toast/status UX across OpenCode surfaces.

## D-0008

- Status: accepted
- Context: Suppressing the next visible prepare after automatic update completion hid useful context-change feedback and conflicted with the desired model-context refresh timing.
- Decision: Do not have automatic update completion suppress the next visible prepare. Idle/status events must not flush visible prepare; only the next real user chat message may surface the visible prepare summary and set the system brief pending. Assistant/non-user messages are ignored.
- Consequences:
  - Pros: Users see context-refresh feedback at the next meaningful turn, and the following system transform receives the updated Project Context Brief.
  - Cons: Live Desktop validation is still needed to confirm the delayed user-message UX across OpenCode surfaces.

## D-0009

- Status: accepted
- Context: Ordinary OpenCode messages, assistant summaries, verification-only work, and commit-only turns were too easy to misclassify as reasons to run automatic Project Context update.
- Decision: Automatic update must be triggered only by a current-turn real engineering file-change event or by explicit scaffold population needs; stale material reasons and plain messages are insufficient.
- Consequences:
  - Pros: Prevents GeneralAgent/plain-message update loops and avoids maintainer tasks without engineering changes.
  - Cons: If a caller fails to emit a file-change event for a real product edit, context update will wait for a later material trigger.

## D-0010

- Status: superseded by D-0011
- Context: Some projects or tests need to prevent automatic Project Context update work without disabling prepare/search or relying on fragile session heuristics.
- Decision: Support a project-level `.crewbee/crewbee.json` opt-out for automatic update, with `projectContext.update.enabled: false` as the canonical shape. Missing, invalid, unreadable, or incomplete config defaults to enabled.
- Consequences:
  - Pros: Gives projects an explicit low-cost kill switch and avoids unnecessary message scanning/draining or maintainer Task creation when disabled.
  - Cons: Misconfigured disabled projects can silently miss context updates until the flag is re-enabled.

## D-0011

- Status: accepted
- Context: Project configuration should disable Project Context as a whole, not only automatic update, so disabled projects avoid both prepare and update overhead and do not keep conflicting update-only semantics.
- Decision: Use `.crewbee/crewbee.json` as the project config and treat `"crewbee-project-context": { "enabled": false }` as the preferred whole-integration opt-out. The reader also accepts `crewbeeProjectContext`, `projectContext`, or `project_context` with a boolean `enabled`; missing, invalid, unreadable, or incomplete config defaults to enabled.
- Consequences:
  - Pros: One clear kill switch covers prepare/system-transform and automatic update paths before expensive OpenCode calls.
  - Cons: Projects that previously wanted prepare/search enabled while only update was disabled need to re-enable Project Context or add a future more specific setting if real demand appears.
