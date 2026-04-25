# Claude-mem Inspired Product Notes

## Context

The target capability is similar in spirit to claude-mem: preserve useful coding-session knowledge and inject relevant context into future sessions. The design here intentionally avoids the heavier operational shape of a memory plugin in the MVP.

## Useful ideas to retain

- Session continuity matters more than raw transcript retention.
- Future sessions need compressed, relevant context rather than full logs.
- Context should be injected automatically enough that humans do not have to remind agents every time.
- Memory should distinguish durable decisions from transient observations.
- Retrieval should happen before broad code exploration.

## Deliberate simplifications

- Use version-controlled project files instead of a separate database first.
- Use explicit `.crewbee/` files instead of hidden opaque memory state.
- Use a low-token primer plus on-demand read/search instead of injecting everything.
- Use manual/tool-confirmed finalize first; avoid uncontrolled automatic rewrites.

## Required memory categories

The project context layer should preserve:

- project identity and scope;
- architecture boundaries and invariants;
- implementation snapshot;
- active plan and next actions;
- blockers and risks;
- accepted decisions;
- high-signal discoveries;
- previous checkpoint observations;
- verification commands and recent verification state.

## Design conclusion

The best path is not to vendor claude-mem directly and not to keep a generic scaffold. The best path is to build a CrewBee-native but standalone project-context layer:

```text
.crewbee/ files + @crewbee/project-context + optional CrewBee integration
```
