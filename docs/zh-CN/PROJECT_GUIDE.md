# crewbee-project-context 最新完整实现方案

## 1. 最终定案

`crewbee-project-context` 是一个独立 OpenCode 插件，与 `crewbee` 插件并列安装、并列加载、协同工作。

```text
OpenCode
  ├─ plugin: crewbee
  │   └─ Agent Team / Leader / Prompt Projection / Delegation / Runtime
  └─ plugin: crewbee-project-context
      └─ Project Context / .crewbeectxt / Maintainer / Handoff / Memory
```

Project Context 的生产 scaffold 目录固定为 `.crewbeectxt/`，与 CrewBee 本体可能使用的 `.crewbee/` 明确分离。

## 2. 核心原则

- 不限制 CrewBee 主 Agent 的 edit/write 权限。
- 主 Agent 只看到 `project_context_prepare`、`project_context_search`、`project_context_finalize` 三个工具。
- 不提供 `project_context_read`，不暴露 `.crewbeectxt/` 文件菜单。
- Maintainer 是 OpenCode hidden subagent，通过工具内部 subsession 被动调用。
- 不使用 `experimental.session.compacting`。
- Maintainer 只维护 `.crewbeectxt/**`，不写业务代码。

## 3. OpenCode hooks

插件只使用：

```text
config
tool
experimental.chat.system.transform
```

不使用：

```text
experimental.session.compacting
chat.message
```

`config` 注入 hidden subagent `project-context-maintainer`，并给 visible primary/all agents 增加 task deny，防止直接 Task 调用 maintainer。

`tool` 注册三工具：

```text
project_context_prepare
project_context_search
project_context_finalize
```

`system transform` 只注入极短 Runtime Rule + compact Context Capsule。

`tool.execute.before` 只兜底阻止直接 Task `project-context-maintainer`，不拦截主 Agent 写 `.crewbee/` 或其它业务文件。

## 4. Hidden Maintainer Agent

注入配置形态：

```json
{
  "agent": {
    "project-context-maintainer": {
      "mode": "subagent",
      "hidden": true,
      "description": "Internal project context maintainer. Invoked only by project_context_* tools.",
      "permission": {
        "read": { "*": "allow", "*.env": "deny", "*.env.*": "deny" },
        "glob": "allow",
        "grep": "allow",
        "edit": { "*": "deny", ".crewbeectxt/**": "allow" },
        "bash": { "*": "deny", "git status *": "allow", "git diff *": "allow", "git log *": "allow" },
        "webfetch": "deny",
        "websearch": "deny",
        "task": "deny"
      }
    }
  }
}
```

主 Agent 不感知 maintainer 的存在；工具内部创建 subsession 并等待最终结果，不暴露 session id、状态或中间输出。

## 5. `.crewbeectxt/` 工作区

```text
.crewbeectxt/
  config.yaml
  PROJECT.md
  ARCHITECTURE.md
  IMPLEMENTATION.md
  PLAN.yaml
  STATE.yaml
  HANDOFF.md
  MEMORY_INDEX.md
  DECISIONS.md
  REFERENCES.md
  observations/
  cache/
```

启动时如果不存在 `.crewbeectxt/`，插件保持 ephemeral mode，不写文件；首次 `project_context_finalize` 且存在 material progress 时自动 bootstrap。

## 6. 工具行为

### `project_context_prepare`

参数：`goal`、可选 `task_type`、可选 `budget`。

内部流程：创建 maintainer subsession，让 Maintainer 准备 compact Task Context Brief。

### `project_context_search`

参数：`goal`、可选 `budget`。

内部流程：Maintainer 自行决定查 memory、decisions、handoff、implementation 或 observations，并返回 compact findings。

### `project_context_finalize`

参数：`summary`、`changed_files`、`verification`、`blockers`、`next_actions`。

内部流程：Maintainer 维护 `.crewbeectxt/**`，插件随后执行 doctor；doctor 失败则工具返回失败。

## 7. 安装与发布

包名与 OpenCode 插件 entry：

```json
{
  "name": "crewbee-project-context",
  "main": "./dist/opencode-plugin.mjs",
  "exports": {
    ".": "./dist/src/index.js",
    "./server": "./dist/opencode-plugin.mjs"
  }
}
```

推荐 OpenCode config：

```json
{
  "plugin": ["crewbee", "crewbee-project-context"]
}
```

## 8. MVP 验收

- OpenCode 能通过 package plugin entry 加载 `crewbee-project-context`。
- 插件不注册 compaction hook。
- 主 Agent 只看到三工具，不看到 maintainer、read 工具或 scaffold 文件菜单。
- hidden maintainer 通过 subsession 执行 prepare/search/finalize。
- `.crewbeectxt/` 只在 material finalize 时创建或更新。
- finalize 后 doctor 通过。

一句话：CrewBee 管“谁来做事”；`crewbee-project-context` 管“工程上下文如何持续维护”；`.crewbeectxt/` 是 Project Context 的私有执行态事实源。
