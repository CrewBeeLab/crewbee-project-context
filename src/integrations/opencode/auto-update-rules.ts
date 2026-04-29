export function isRuntimeText(text: string): boolean {
  return /Project Context (prepared|update) ·/i.test(text)
    || /Project Context (Maintainer|Update)/i.test(text)
    || /Project Context workspace is private/i.test(text)
    || /Unable to update private Project Context scaffold/i.test(text)
    || /PROJECT_CONTEXT_UPDATE_DONE\s+job=pcu_[a-z0-9_]+\s+status=(ok|failed)/i.test(text)
    || /<task_result>|<\/task_result>|task_id: .*for resuming to continue this task/i.test(text)
    || /Summarize the task tool output above and continue with your task\.?/i.test(text)
    || /Project Context Maintainer job: update/i.test(text)
    || /project-context-maintainer|project_context_update|project_context_prepare|pcu_[a-z0-9_]+/i.test(text);
}

export function isUserText(role: string | undefined, text: string): boolean {
  return role === "user" && text.trim().length > 0 && !isRuntimeText(text);
}

export function isAssistantText(role: string | undefined, text: string): boolean {
  return role === "assistant" && text.trim().length > 0 && !isRuntimeText(text);
}

export function textMaterialReasons(role: string | undefined, text: string): string[] {
  if (text.length === 0) return [];
  if (isRuntimeText(text)) return [];
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  if (role === "assistant") {
    if (/(决定|采用|废弃|改为|最终方案|decision|decided|adopt|deprecate)/i.test(text)) reasons.push("decision");
    if (/(计划|下一步|后续|todo|next step|plan|follow-up)/i.test(text)) reasons.push("plan_or_next_actions");
    if (/(阻塞|失败|无法继续|待确认|blocker|blocked|failed|cannot proceed)/i.test(text)) reasons.push("blocker");
    if (/(已实现|已修复|重构|迁移|implemented|fixed|refactored|migrated)/i.test(text)) reasons.push("implementation_state");
  }
  if (role === "user" && /(记录到上下文|更新上下文|更新项目记忆|record.*context|update.*context)/i.test(lower)) reasons.push("user_requested_context_update");
  return [...new Set(reasons)];
}

export function stringifyArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return String(args ?? "");
  }
}

export function materialReason(toolName: string, args: unknown): string | null {
  const text = `${toolName} ${stringifyArgs(args)}`.toLowerCase();
  if (["edit", "write", "patch", "apply_patch", "apply_patch.apply_patch"].some((name) => toolName.toLowerCase().includes(name))) return "files_changed";
  if (toolName === "project_context_search") return "context_search";
  if (toolName === "bash" && /\b(test|build|typecheck|lint|doctor)\b/.test(text)) return "verification";
  return null;
}
