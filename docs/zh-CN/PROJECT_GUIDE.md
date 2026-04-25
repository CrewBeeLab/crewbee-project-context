# CrewBee Project Context 最小注意力实现方案

## 1. 项目定位

CrewBee Project Context 是 CrewBee 的轻量项目上下文侧车。它维护 `.crewbee/` 项目上下文工作区，但不让主 Coding Agent 直接理解、读取或编辑 scaffold 文件结构。

目标是：

> 让 OpenCode + CrewBee 的 Agent Team 在执行任务前以最小上下文成本获得项目连续性；任务结束后把 `.crewbee/` 维护委托给独立 Context Maintainer，而不是占用主 Coding Agent 的注意力。

它不是重型记忆数据库，不是完整知识库，也不是新的 Agent Runtime。它应作为 CrewBee OpenCode 插件的可选运行时扩展，安装后自动生效。

## 2. 核心原则

1. **安装后即插即用**：启动 OpenCode + CrewBee 后自动检测 Project Context，不要求用户手动执行 init。
2. **主 Agent 不理解 scaffold 结构**：主 Agent 不需要知道 `.crewbee/HANDOFF.md`、`PLAN.yaml`、`MEMORY_INDEX.md` 等文件名和语义。
3. **不提供 `project_context_read`**：读取哪些 scaffold 文件由 Context Maintainer 决定，不由主 Agent 决定。
4. **维护工作委托给 Maintainer**：主 Coding Leader 只请求 prepare/search/finalize_request，不直接维护 `.crewbee/`。
5. **CLI 只作内部调试入口**：CLI 可用于开发、测试、doctor、fixture，不作为用户主流程。
6. **硬控上下文预算**：主 prompt 只注入极短 Runtime Rule 与 Context Capsule；长文档不进入主会话。

## 3. 总体架构

```text
OpenCode
  -> CrewBee OpenCode Plugin
  -> CrewBee Team / Agent Runtime
  -> Project Context Extension
  -> project_context_prepare / project_context_search / project_context_finalize_request
  -> Project Context Maintainer sub session
  -> .crewbee/ context workspace
```

CrewBee Core 不依赖 Project Context。Project Context 只接入 CrewBee 的 OpenCode plugin/runtime extension 层。

## 4. `.crewbee/` 工作区

`.crewbee/` 是唯一生产上下文目录名。模板源在 `templates/crewbee-template/`，但目标项目运行时只使用 `.crewbee/`。

```text
.crewbee/
  config.yaml
  PROJECT.md
  ARCHITECTURE.md
  IMPLEMENTATION.md
  PLAN.yaml
  STATE.yaml
  HANDOFF.md
  MEMORY_INDEX.md
  DECISIONS.md
  observations/
  cache/
```

这些文件是事实源，但默认不整体进入主会话。主会话只接收 capsule 摘要。

## 5. 自动初始化策略

Project Context 采用 Lazy Auto Bootstrap：

- 启动时检测 `.crewbee/`。
- 若不存在，进入 ephemeral context mode，不立刻落盘。
- 首次 `project_context_finalize_request` 且存在值得保留的项目进展时，自动创建最小 `.crewbee/`。
- 已存在 `.crewbee/` 时直接生成 capsule 并启用工具。

这样避免在无关仓库中启动 OpenCode 时自动写入文件，也避免用户手动 init。

## 6. 主会话注入

只注入两段：

### 6.1 Runtime Rule

控制在 120-180 tokens，表达：

```text
Use project_context_prepare before broad project-context exploration.
Use project_context_search only when prepared context is insufficient.
Do not read or edit .crewbee files directly in the main coding flow.
After material changes, call project_context_finalize_request with completed work, changed files, verification, blockers, and next actions.
```

### 6.2 Context Capsule

控制在 400-700 tokens，只包含项目名、状态、active step、last checkpoint、blockers、next actions、Top N memory 和可用工具名。

不暴露 `.crewbee/` 文件菜单。

## 7. 工具接口

只给主 Agent 暴露 3 个工具：

```text
project_context_prepare
project_context_search
project_context_finalize_request
```

### 7.1 `project_context_prepare`

任务开始前获取任务相关上下文。主 Agent 只描述目标，不指定文件。

```json
{
  "goal": "Implement the OpenCode integration bridge.",
  "task_type": "coding",
  "budget": "compact"
}
```

返回 Task Context Brief，不返回 scaffold 原文。

### 7.2 `project_context_search`

当 prepare 不够时，请 Maintainer 继续查上下文。

```json
{
  "goal": "Find prior decisions about CrewBee core coupling.",
  "budget": "compact"
}
```

Maintainer 自行决定查 `MEMORY_INDEX`、`DECISIONS`、`HANDOFF`、`IMPLEMENTATION` 或 observations。

### 7.3 `project_context_finalize_request`

任务结束后提交事实，由 Maintainer 独立维护 `.crewbee/`。

```json
{
  "summary": "Implemented minimal Project Context tool surface.",
  "changed_files": ["src/integrations/crewbee/extension.ts"],
  "verification": ["npm test passed"],
  "blockers": [],
  "next_actions": ["Wire plugin into CrewBee OpenCode runtime."]
}
```

Maintainer 写入 `.crewbee/` 后运行 doctor，并返回极简结果。

## 8. Context Maintainer

`project-context-maintainer` 是内部 subagent：

```yaml
visibility: internal
user_selectable: false
delegate_only: true
```

职责：

- 为主 Agent 准备任务相关上下文。
- 根据目标搜索历史上下文。
- 任务结束后维护 `.crewbee/`。
- 保持 handoff 可执行、memory 高信号、observations 精简。

权限：

- 可读 `.crewbee/**`、必要 `docs/**`、变更摘要与验证事实。
- 可写 `.crewbee/**`。
- 不写业务代码、测试、package 文件。

## 9. 实现模块

```text
src/
  core/                 类型、预算、错误
  workspace/            .crewbee 路径、bootstrap、doctor、文件访问
  indexer/              上下文解析
  capsule/              capsule/brief 构建
  maintainer/           内部 Context Maintainer、search、patch、finalize
  service/              ProjectContextService 门面
  integrations/crewbee/ CrewBee extension/prompt/tools/internal-agent
  cli/                  internal doctor/primer diagnostics only
```

当前 TypeScript 实现采用小型 OOP 结构：`ProjectContextService` 协调 Workspace、Capsule、Maintainer、Search、Patch、Finalizer 与 CrewBee Extension。

当前包内提供 `ProjectContextMaintainer` 作为最小内部执行器；在 CrewBee/OpenCode 运行时中，它应被映射为独立 sub session / internal agent。

当前仓库已经完成 sidecar package 与 adapter-facing extension；真正的 OpenCode plugin hook、CrewBee runloop tool registration 与 internal sub session 映射需要在 CrewBee 运行时仓库中接入。

## 10. CrewBee + OpenCode 集成

插件启动流程：

```text
CrewBee OpenCode plugin loads
  -> detect project root
  -> detect .crewbee/
  -> if missing: ephemeral mode
  -> if present: build Context Capsule
  -> inject Runtime Rule + Capsule
  -> register project_context_prepare/search/finalize_request
  -> register internal project-context-maintainer
```

无 `.crewbee/` 时不报错、不强制 init、不污染主 prompt；首次 finalize_request 时按需 bootstrap。

## 11. 防上下文膨胀硬约束

- Runtime Rule ≤ 180 tokens。
- Context Capsule ≤ 700 tokens。
- prepare 默认 ≤ 1000 tokens。
- search 默认 ≤ 800 tokens。
- finalize_request 返回 ≤ 300 tokens。
- 不提供 `project_context_read`。
- 主 Agent 不接收 scaffold 文件路径菜单。
- 主 Agent 不直接维护 `.crewbee/`。
- Maintainer sub session 独立消耗上下文。
- finalize 后必须 doctor。
- `MEMORY_INDEX` 只保存 high-signal 条目。
- observations 默认不进入主 prompt。

## 12. 产品主流程

```text
用户提出 coding 任务
  -> CrewBee Leader 看到极小 capsule
  -> 调用 project_context_prepare
  -> 执行代码任务
  -> 必要时调用 project_context_search
  -> 完成后调用 project_context_finalize_request
  -> Maintainer 独立维护 .crewbee/
```

最终定案：Project Context 是 CrewBee 的上下文维护侧车，而不是主 Agent 的文档阅读任务。
