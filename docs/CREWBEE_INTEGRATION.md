# CrewBee + Project Context Integration Design

## Principle

`crewbee` and `crewbee-project-context` are sibling OpenCode plugins.

```text
crewbee
  -> Team / Agent projection, delegation, runtime binding

crewbee-project-context
  -> private context workspace, auto init, auto prepare, optional search, auto update
```

Project Context does not enter CrewBee Core, does not become a visible CrewBee Team member, and does not use CrewBee `delegate_task`.

## Plugin order

Recommended OpenCode config:

```json
{
  "plugin": ["crewbee", "crewbee-project-context"]
}
```

CrewBee projects visible agents first. Project Context then injects hidden `project-context-maintainer`, registers the single visible search tool, and adds a task deny guard so primary agents do not call the maintainer directly.

## Main-agent surface

Visible to CrewBee/OpenCode primary agents:

```text
project_context_search
```

Automatic runtime actions, not visible tools:

```text
auto init
auto prepare
auto update
```

Not visible:

```text
project_context_read
.crewbeectxt file menu
project-context-maintainer prompt
maintainer subsession id/status
```

## Hooks

Project Context uses:

```text
config
tool
event
chat.message
experimental.chat.system.transform
tool.execute.before
tool.execute.after
```

It intentionally does not use `experimental.session.compacting`; initialization and prepare are handled by system transform, while update is handled by chat/message, tool, and session events.

## Private workspace visibility

The project context workspace is private to the plugin runtime and hidden maintainer. It is not exposed to the main CrewBee/OpenCode agent through prompt text, capsule metadata, tool schemas, direct tool arguments, or non-maintainer tool outputs.

Rules enforced by the OpenCode adapter:

- Main-agent system/capsule text does not include private workspace paths or file menus.
- `project_context_search` accepts a goal, not context file paths.
- `tool.execute.before` blocks non-maintainer direct tool arguments that reference the private workspace.
- `tool.execute.after` redacts private workspace paths from non-maintainer tool outputs.
- Hidden `project-context-maintainer` remains allowed to read/write the private workspace.
- Watcher ignores private cache/tmp/lock noise only; durable context files remain normal filesystem/Git files for maintainers and humans.

## Install / doctor flow

Project Context follows the same operational shape as CrewBee for local user-level OpenCode installation:

```bash
npm run pack:local
npm run install:local:user
npm run doctor
```

The installer writes the canonical package-name plugin entry `crewbee-project-context` into OpenCode config. If `crewbee` is already present, the project-context entry is placed after it. Doctor validates the installed package entrypoint, plugin order, hidden maintainer config, task deny, private workspace guard/redactor, search-only tool surface, absence of `project_context_read`, and absence of `experimental.session.compacting`.

## Runtime rule

Injected rule is compact:

```text
Project Context is prepared automatically when needed.
Use project_context_search only if the prepared context is missing or insufficient for prior project decisions, plan, risks, or implementation history.
```

## Automatic initialization

On the first root-session prompt, `experimental.chat.system.transform` checks whether the private scaffold framework exists. If the context directory or required scaffold files are missing, the plugin creates the template scaffold locally, then starts a hidden maintainer `initialize` job. That job is asked to read project documentation, architecture/design notes, package metadata, tests, and main source implementation, and to initialize the scaffold content. The maintainer job is fire-and-forget and does not block prompt construction. Ordinary content validation errors do not trigger scaffold recreation.

## Automatic prepare

`experimental.chat.system.transform` injects the runtime rule. On the first root-session prompt, it also runs local deterministic prepare and injects a compact Project Context Brief. Prepare does not call a model, does not create a subsession, and does not expose private workspace paths.

## Automatic update

The `event` hook listens for `session.idle` and `session.status` with `status.type === "idle"`. `chat.message` records explicit user context-update intent. `tool.execute.before` captures tool args by `sessionID + callID`; `tool.execute.after` consumes the captured call and records material signals such as file edits, verification commands, and search usage. On idle, auto update scans recent session messages, evaluates every turn, skips no-material turns, and starts a hidden maintainer update job only when durable project information likely changed.

Update results are logged internally and are not injected into the main-agent reply. The next auto prepare reads the updated context.

## Maintainer execution

```text
auto init, auto update, or project_context_search
  -> crewbee-project-context plugin creates OpenCode subsession
  -> hidden project-context-maintainer runs with restricted permissions
  -> maintainer initializes/searches/updates the private workspace
  -> plugin runs doctor after update jobs
  -> search returns compact findings or update records internal status
```

No status, cancel, or streaming interface is exposed for maintainer jobs in V1.

## Non-goals

- No compaction hook.
- No project_context_read.
- No visible prepare/update/finalize tools.
- No visible maintainer agent.
- No CrewBee Core contract change.
- No modification to primary agent edit/write permissions.
- No SQLite/vector database/background sync daemon.