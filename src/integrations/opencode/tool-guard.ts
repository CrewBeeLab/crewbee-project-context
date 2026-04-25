import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import { containsPrivateContextPath, isProjectContextMaintainer } from "./visibility.js";

function readTarget(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  const value = record.subagent_type ?? record.agent ?? record.subagent;
  return typeof value === "string" ? value : undefined;
}

export function createProjectContextToolGuard() {
  return async (input: { tool: string; agent?: string; args?: unknown }, output: { args?: unknown }): Promise<void> => {
    if (isProjectContextMaintainer(input.agent)) return;
    if (containsPrivateContextPath(input.args) || containsPrivateContextPath(output.args)) {
      throw new Error("Project Context workspace is private. Use project_context_prepare, project_context_search, or project_context_finalize.");
    }
    if (input.tool !== "task") return;
    const target = readTarget(output.args) ?? readTarget(input.args);
    if (target !== PROJECT_CONTEXT_MAINTAINER_AGENT_ID) return;
    throw new Error("Do not invoke project-context-maintainer directly. Use project_context_prepare, project_context_search, or project_context_finalize.");
  };
}
