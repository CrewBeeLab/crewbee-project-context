# crewbee-project-context 最新完整实现方案

## 1. 最终定案

`crewbee-project-context` 是一个独立 OpenCode 插件，与 `crewbee` 插件并列安装、并列加载、协同工作。

```text
OpenCode
  ├─ plugin: crewbee
  │   └─ Agent Team / Leader / Prompt Projection / Delegation / Runtime
  └─ plugin: crewbee-project-context
      ├─ Auto Prepare
      ├─ Auto Update
      ├─ Visible Tool: project_context_search
      └─ Hidden Maintainer
```

Project Context 的生产 scaffold 目录固定为 `.crewbeectxt/`，与 CrewBee 本体可能使用的 `.crewbee/` 明确分离。

## 2. 核心原则

- 不限制 CrewBee 主 Agent 的 edit/write 权限。
- 主 Agent 只看到 `project_context_search` 一个工具。
- prepare 自动执行：本地 I/O，快速注入 compact brief。
- update 自动执行：主 Agent 回复完成后，按 material change 判断是否启动 hidden maintainer。
- 不提供 `project_context_read`，不暴露 `.crewbeectxt/` 文件菜单。
- Maintainer 是 OpenCode hidden subagent，通过插件 runtime 被动调用。
- 不使用 `experimental.session.compacting`。
- Maintainer 只维护 `.crewbeectxt/**`，不写业务代码。

## 3. OpenCode hooks

插件使用：

```text
config
tool
event
experimental.chat.system.transform
tool.execute.before
tool.execute.after
```

`config` 注入 hidden subagent `project-context-maintainer`，并给 visible primary/all agents 增加 task deny，防止直接 Task 调用 maintainer。

`tool` 只注册：

```text
project_context_search
```

`experimental.chat.system.transform` 注入极短 Runtime Rule，并在需要时自动注入 Project Context Brief。

`event` 监听 `session.idle`，用于自动 update 评估。

`tool.execute.before/after` 用于私有路径 guard、输出脱敏，以及记录 material change 信号。

## 4. Hidden Maintainer Agent

Maintainer 配置为 `mode: subagent`、`hidden: true`。主 Agent 不感知 maintainer 的存在；插件内部创建 subsession 并等待最终结果，不暴露 session id、状态或中间输出。

Maintainer 权限：

```text
read/glob/grep: allow
edit: only .crewbeectxt/**
bash: only git status/diff/log
webfetch/websearch/task/session/project_context_*: deny
```

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

启动时如果不存在 `.crewbeectxt/`，auto prepare 快速降级。auto update 只有检测到 material change 时才尝试通过 maintainer 维护 context。

## 6. 自动 Prepare

Auto Prepare 是 prompt 构建阶段的本地动作，不是工具：

```text
system transform
  -> 判断是否需要 prepare
  -> ProjectContextService.prepareContext()
  -> 注入 compact Project Context Brief
```

约束：

```text
不调用 LLM
不创建 subsession
不调用 hidden maintainer
不读取代码仓库全文
不暴露 .crewbeectxt 路径
```

## 7. 手动 Search

`project_context_search` 是唯一主 Agent 可见工具。

使用原则：只有自动 brief 缺失或不足，并且任务依赖历史决策、计划、风险、实现背景时才调用。它不用于普通代码搜索。

内部流程：

```text
project_context_search
  -> MaintainerJob(search)
  -> hidden project-context-maintainer subsession
  -> 返回 compact findings
```

## 8. 自动 Update

Auto Update 是主 Agent 回复完成后的自动维护动作，不是工具：

```text
tool.execute.after 收集 material signals
session.idle 触发 AutoUpdateManager
如果无 material change：skip
如果有 material change：MaintainerJob(update)
```

Material change 信号包括：文件编辑、测试/构建/typecheck/lint、关键决策、计划变化、阻塞、用户明确要求记录上下文，以及 search 后产生长期有效结论。

Update 失败只写日志和内部状态，不污染主 Agent 当前回复；下一轮 prepare 继续使用现有 context。

## 9. 安装与发布

推荐 OpenCode config：

```json
{
  "plugin": ["crewbee", "crewbee-project-context"]
}
```

常用验证：

```bash
npm run typecheck
npm test
npm run diagnostics
npm run install:local:user
npm run doctor
```

## 10. MVP 验收

- OpenCode 能通过 package plugin entry 加载 `crewbee-project-context`。
- 插件不注册 compaction hook。
- 主 Agent 只看到 `project_context_search`。
- session 首次 root prompt 自动注入 brief。
- follow-up 不重复注入 brief。
- 有 material change 且 session idle 后自动触发 update。
- hidden maintainer 通过 subsession 执行 search/update。
- `.crewbeectxt/` 不暴露给主 Agent。
- doctor 通过。

一句话：CrewBee 管“谁来做事”；`crewbee-project-context` 自动准备和维护工程上下文；主 Agent 只在少数需要历史背景时使用 `project_context_search`。