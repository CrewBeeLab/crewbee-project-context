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
  "plugin": ["crewbee", "crewbee-project-context@latest"]
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

`experimental.chat.system.transform` is only a model-context hook and does not by itself create a visible Desktop session message. Project Context therefore uses `chat.message` as the lifecycle signal and writes a separate `session.prompt({ noReply: true })` prepare summary with `ignored: true`. Desktop can show that summary as a normal session message, while OpenCode excludes it from later model messages. The compact brief itself is still injected by system transform when prepare is needed.

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

The installer writes the canonical latest package plugin entry `crewbee-project-context@latest` into OpenCode config. If `crewbee` is already present, the project-context entry is placed after it. Doctor validates the installed package entrypoint, plugin order, hidden maintainer config, task deny, private workspace guard/redactor, search-only tool surface, absence of `project_context_read`, and absence of `experimental.session.compacting`.

## Runtime rule

Injected rule is compact:

```text
Project Context is prepared automatically when needed.
Do not call project_context_search unless auto init/prepare/update still leave a concrete historical project-context gap that blocks the task.
```

## Automatic initialization

On the first root-session prompt, `experimental.chat.system.transform` checks whether the private scaffold framework exists. If the context directory or required scaffold files are missing, the plugin creates the template scaffold locally, then starts a hidden maintainer `initialize` job. That job is asked to read project documentation, architecture/design notes, package metadata, tests, and main source implementation, and to initialize the scaffold content. The maintainer job is fire-and-forget and does not block prompt construction. Ordinary content validation errors do not trigger scaffold recreation.

## Automatic prepare

`chat.message` and `experimental.chat.system.transform` jointly implement prepare. The visible side writes a short no-reply, ignored main-session status message such as `Project Context prepared · compact · revision ...`; the model side injects the runtime rule and compact Project Context Brief. Prepare does not call a model, does not create a subsession, and does not expose private workspace paths. The implementation tracks visible and system revisions separately so a system-transform-first or revision-change path cannot suppress the required visible prepare message.

## Automatic update

The `event` hook listens for `session.idle` and `session.status` with `status.type === "idle"`. `chat.message` records explicit user context-update intent. `tool.execute.before` captures tool args by `sessionID + callID`; `tool.execute.after` consumes the captured call and records material signals such as file edits, verification commands, and search usage. On every idle turn, auto update scans recent session messages and records an `evaluated` runtime event. No-material turns are evaluated and skipped; durable project changes start a hidden maintainer update job.

Update is launched by submitting a `subtask` part to the parent session with `agent: project-context-maintainer` and `command: project_context_update`. OpenCode handles that through its official task-tool flow: it creates a parent-linked hidden maintainer child session, executes the maintainer Agent there, and renders a clickable Task card in the parent Desktop session via `metadata.sessionId`. The subtask prompt is intentionally short: it references a one-time private JSON payload under `.crewbee/.prjctxt/cache/update-jobs/` instead of embedding the latest user request, assistant conclusion, git summaries, or verification output into the parent session. The runtime deletes that payload after the internal update task completes. The main Agent never receives `project_context_update` as a visible tool and cannot directly Task the maintainer outside this internal command. The next auto prepare reads the updated context.

## Maintainer execution

```text
auto init or project_context_search
  -> crewbee-project-context plugin creates OpenCode subsession
auto update
  -> crewbee-project-context plugin submits parent-session subtask part
  -> plugin writes one-time private update job payload
  -> OpenCode task tool creates linked maintainer child session
  -> maintainer reads the private update job payload
  -> hidden project-context-maintainer runs with restricted permissions
  -> maintainer initializes/searches/updates the private workspace
  -> plugin runs doctor after update jobs
  -> search returns compact findings or update records internal status
```

No status, cancel, or streaming interface is exposed to the main Agent for maintainer jobs in V1.

The parent session receives the official Task card for auto update, not the maintainer transcript. The maintainer prompt, private workspace paths, and detailed scaffold edits remain inside the child session/private workspace boundary, while Desktop can navigate from the card to the child session record.

## Non-goals

- No compaction hook.
- No project_context_read.
- No visible prepare/update tools.
- No visible maintainer agent.
- No CrewBee Core contract change.
- No modification to primary agent edit/write permissions.
- No SQLite/vector database/background sync daemon.
