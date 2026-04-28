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
  "plugin": ["crewbee", "crewbee-project-context@0.1.1"]
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
.crewbee/.prjctxt file menu
project-context-maintainer prompt
maintainer transcript/scaffold edits
```

Visible by design:

```text
compact prepare summary in the parent chat
compact update status with maintainer child-session reference in the parent chat
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

`experimental.chat.system.transform` is only a model-context hook and does not by itself create a visible Desktop session message. Project Context therefore uses the TUI status/toast surface before assistant execution to show a short `Project Context Prepare Summary`, and also appends a synthetic ignored `chat.message` text part when the chat-message hook has an output object so the same summary is visible in Desktop Web UI session UI but filtered out of future model context. It intentionally does not write a no-reply parent-session prompt because OpenCode `session.prompt(noReply)` creates a user message, not an assistant/status message. If OpenCode later provides a first-class assistant-side persistent status message API, Project Context should move this visible prepare summary to that API.

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

The installer writes the canonical pinned package plugin entry `crewbee-project-context@0.1.1` into OpenCode config. If `crewbee` is already present, the project-context entry is placed after it. Doctor validates the installed package entrypoint, plugin order, hidden maintainer config, task deny, private workspace guard/redactor, search-only tool surface, absence of `project_context_read`, and absence of `experimental.session.compacting`.

## Runtime rule

Injected rule is compact:

```text
Project Context is prepared automatically when needed.
Do not call project_context_search unless auto init/prepare/update still leave a concrete historical project-context gap that blocks the task.
```

## Automatic initialization

On the first root-session prompt, `experimental.chat.system.transform` checks whether the private scaffold framework exists. If the context directory or required scaffold files are missing, the plugin creates the template scaffold locally, then starts a hidden maintainer `initialize` job. That job is asked to read project documentation, architecture/design notes, package metadata, tests, and main source implementation, and to initialize the scaffold content. The maintainer job is fire-and-forget and does not block prompt construction. Ordinary content validation errors do not trigger scaffold recreation.

## Automatic prepare

`chat.message`, `experimental.chat.system.transform`, `experimental.chat.messages.transform`, and idle events jointly implement prepare. The visible side emits a short pre-assistant TUI status/toast titled `Project Context Prepare Summary` with text such as `Project Context Prepare Summary · compact · revision ...`; in the user-message phase it also appends the same text as a synthetic ignored chat part for Desktop Web UI visibility. The model side injects the runtime rule and compact Project Context Brief, then filters any prepare-summary runtime text from future model context. Prepare does not call a model, does not create a subsession, does not create a user-message prompt, and does not expose private workspace paths. The implementation tracks visible and system revisions separately so a system-transform-first or revision-change path cannot suppress the required visible prepare summary.

## Automatic update

The `event` hook listens for `session.idle` and `session.status` with `status.type === "idle"`. `chat.message` records explicit user context-update intent. `tool.execute.before` captures tool args by `sessionID + callID`; `tool.execute.after` consumes the captured call and records material signals such as file edits, verification commands, and search usage. On idle, auto update scans recent session messages, evaluates only previously unseen message fingerprints, skips no-material/runtime turns, and starts a hidden maintainer update job only when durable project information likely changed.

Update is launched through OpenCode's official parent-session `subtask` / Task-card flow targeting the hidden `project-context-maintainer` agent. The main Agent never receives `project_context_update` as a tool and cannot directly Task the maintainer. The parent prompt contains only a compact Job ID; the full update payload is written before launch to `.crewbee/.prjctxt/cache/update-jobs/<jobID>.json`, retained long enough for the asynchronous Task run, and then cleaned later on a runtime TTL. If update launch or execution fails, the failure is logged and treated as best-effort auxiliary work; it is not retried from the failure message and must not block the primary development task.

## Maintainer execution

```text
auto update
  -> crewbee-project-context plugin writes private update job payload
  -> parent session gets an OpenCode subtask / Task card
  -> hidden project-context-maintainer reads the payload by Job ID
  -> maintainer updates only the private context scaffold
  -> failures are logged once and ignored as auxiliary work
```

No status, cancel, or streaming interface is exposed to the main Agent for maintainer jobs in V1.

The parent session receives only the Task card and compact Job ID prompt, not the full payload. The maintainer prompt, private workspace paths, and detailed scaffold edits remain inside the child session/private workspace boundary.

## Non-goals

- No compaction hook.
- No project_context_read.
- No visible prepare/update/finalize tools.
- No visible maintainer agent.
- No CrewBee Core contract change.
- No modification to primary agent edit/write permissions.
- No SQLite/vector database/background sync daemon.
