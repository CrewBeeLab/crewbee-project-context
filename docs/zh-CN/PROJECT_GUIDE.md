# crewbee-project-context 最新完整实现方案

## 1. 最终定案

`crewbee-project-context` 是一个独立 OpenCode 插件，与 `crewbee` 插件并列安装、并列加载、协同工作。

```text
OpenCode
  ├─ plugin: crewbee
  │   └─ Agent Team / Leader / Prompt Projection / Delegation / Runtime
  └─ plugin: crewbee-project-context
      ├─ Auto Init
      ├─ Auto Prepare
      ├─ Auto Update
      ├─ Visible Tool: project_context_search
      └─ Hidden Maintainer
```

Project Context 的生产 scaffold 目录固定为 `.crewbeectxt/`，与 CrewBee 本体可能使用的 `.crewbee/` 明确分离。

## 2. 核心原则

- 不限制 CrewBee 主 Agent 的 edit/write 权限。
- 主 Agent 只看到 `project_context_search` 一个工具，但调用阈值很高：仅作为阻塞性历史上下文缺口的低频兜底。
- init 自动执行：首个 root session 启动时，如 scaffold 框架缺失则创建模板并委派 maintainer 初始化。
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
chat.message
experimental.chat.system.transform
tool.execute.before
tool.execute.after
```

`config` 注入 hidden subagent `project-context-maintainer`，并给 visible primary/all agents 增加 task deny，防止直接 Task 调用 maintainer。

`tool` 只注册：

```text
project_context_search
```

`experimental.chat.system.transform` 负责首启 scaffold 检查/创建、注入极短 Runtime Rule，并在需要时自动注入 Project Context Brief。

`event` 监听 `session.idle` 和 `session.status` idle，用于自动 update 评估。

`chat.message` 记录用户显式上下文更新意图。`tool.execute.before/after` 用于私有路径 guard、输出脱敏、按 sessionID+callID 捕获工具参数，以及记录 material change 信号。

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

启动时如果 scaffold 目录或 required scaffold 文件缺失，插件会本地创建模板框架，并启动 hidden maintainer 的 initialize job。initialize job 会阅读工程文档、架构/设计说明、package metadata、tests 和主要源码实现，然后初始化 scaffold 内容。普通内容校验错误不会触发重建。

## 6. 自动 Init

Auto Init 是首个 root session prompt 构建阶段的内部动作：

```text
system transform
  -> 检查 scaffold 框架是否存在
  -> 缺失时 ProjectContextService.initProjectContext() 创建模板
  -> fire-and-forget 启动 MaintainerJob(initialize)
  -> maintainer 阅读 docs / architecture / tests / package metadata / 主要源码
  -> maintainer 初始化私有 context 内容
```

初始化不会暴露私有路径给主 Agent，也不会阻塞 prompt 构建等待 LLM 完成。

## 7. 自动 Prepare

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

## 8. 手动 Search

`project_context_search` 是唯一主 Agent 可见工具。

使用原则：默认不调用。只有 auto init / auto prepare / auto update 仍无法提供足够信息，并且存在阻塞任务推进的具体历史项目上下文缺口时才调用。它不用于普通代码搜索、常规熟悉项目或补充性浏览。

内部流程：

```text
project_context_search
  -> MaintainerJob(search)
  -> hidden project-context-maintainer subsession
  -> 返回 compact findings
```

## 9. 自动 Update

Auto Update 是主 Agent 回复完成后的自动维护动作，不是工具：

```text
chat.message 记录用户显式上下文更新意图
tool.execute.before 捕获工具 args
tool.execute.after 收集 material signals
session.idle / session.status idle 触发 AutoUpdateManager
如果无 material change：skip
如果有 material change：MaintainerJob(update)
```

Material change 信号包括：文件编辑、测试/构建/typecheck/lint、关键决策、计划变化、阻塞、用户明确要求记录上下文，以及 search 后产生长期有效结论。

Update 失败只写日志和内部状态，不污染主 Agent 当前回复；下一轮 prepare 继续使用现有 context。

## 10. 安装与发布

推荐 OpenCode config：

```json
{
  "plugin": ["crewbee", "crewbee-project-context@latest"]
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

## 11. MVP 验收

- OpenCode 能通过 package plugin entry 加载 `crewbee-project-context`。
- 插件不注册 compaction hook。
- 主 Agent 只看到 `project_context_search`。
- 首个 root prompt 如果 scaffold 缺失，会自动创建模板并启动 maintainer initialize job。
- session 首次 root prompt 自动注入 brief。
- follow-up 不重复注入 brief。
- 有 material change 且 session idle 后自动触发 update。
- hidden maintainer 通过 subsession 执行 initialize/search/update。
- `.crewbeectxt/` 不暴露给主 Agent。
- doctor 通过。

一句话：CrewBee 管“谁来做事”；`crewbee-project-context` 自动准备和维护工程上下文；主 Agent 只在自动上下文仍不足且存在阻塞性历史上下文缺口时才使用 `project_context_search`。
