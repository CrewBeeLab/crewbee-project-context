import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";

function readTarget(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  const value = record.subagent_type ?? record.agent ?? record.subagent;
  return typeof value === "string" ? value : undefined;
}

export function createProjectContextToolGuard() {
  return async (input: { tool: string }, output: { args: unknown }): Promise<void> => {
    if (input.tool !== "task") return;
    if (readTarget(output.args) !== PROJECT_CONTEXT_MAINTAINER_AGENT_ID) return;
    throw new Error("Do not invoke project-context-maintainer directly. Use project_context_prepare, project_context_search, or project_context_finalize.");
  };
}
