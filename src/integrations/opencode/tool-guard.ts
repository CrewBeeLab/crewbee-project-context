import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import { containsPrivateContextPath, isProjectContextMaintainer } from "./visibility.js";
import type { OpenCodeClientLike } from "./types.js";
import { writeRuntimeLog } from "./runtime-log.js";

const PROJECT_CONTEXT_TOOL_NAMES = new Set(["project_context_search"]);

function readTarget(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  const value = record.subagent_type ?? record.agent ?? record.subagent;
  return typeof value === "string" ? value : undefined;
}

function isProjectContextTool(tool: string): boolean {
  return PROJECT_CONTEXT_TOOL_NAMES.has(tool);
}

function readParentID(session: unknown): string | undefined {
  if (typeof session !== "object" || session === null || Array.isArray(session)) return undefined;
  const record = session as Record<string, unknown>;
  if (typeof record.parentID === "string") return record.parentID;
  const data = record.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) return readParentID(data);
  return undefined;
}

async function isSubsession(client: OpenCodeClientLike | undefined, sessionID: string, projectRoot: string | undefined): Promise<boolean> {
  if (!client?.session.get) return false;
  const query = projectRoot ? { directory: projectRoot, workspace: projectRoot } : undefined;
  const session = await client.session.get({ path: { id: sessionID }, ...(query ? { query } : {}) });
  return readParentID(session) !== undefined;
}

export function createProjectContextToolGuard(options: { client?: OpenCodeClientLike; projectRoot?: string } = {}) {
  return async (event: { tool: string; sessionID: string; agent?: string; args?: unknown }, output: { args?: unknown }): Promise<void> => {
    if (options.projectRoot) await writeRuntimeLog(options.projectRoot, { component: "tool-guard", event: "tool-before", sessionID: event.sessionID, agent: event.agent, tool: event.tool });
    if (isProjectContextTool(event.tool)) {
      if (isProjectContextMaintainer(event.agent)) {
        if (options.projectRoot) await writeRuntimeLog(options.projectRoot, { component: "tool-guard", event: "block-maintainer-recursion", sessionID: event.sessionID, agent: event.agent, tool: event.tool });
        throw new Error("Project Context Maintainer must not call project_context_search recursively.");
      }
      if (await isSubsession(options.client, event.sessionID, options.projectRoot)) {
        if (options.projectRoot) await writeRuntimeLog(options.projectRoot, { component: "tool-guard", event: "block-subsession-project-context-tool", sessionID: event.sessionID, agent: event.agent, tool: event.tool });
        throw new Error("Project Context tools are available only to root primary-agent sessions, not subsessions or subagents.");
      }
      if (options.projectRoot) await writeRuntimeLog(options.projectRoot, { component: "tool-guard", event: "allow-project-context-tool", sessionID: event.sessionID, agent: event.agent, tool: event.tool });
    }
    if (isProjectContextMaintainer(event.agent)) return;
    if (containsPrivateContextPath(event.args) || containsPrivateContextPath(output.args)) {
      throw new Error("Project Context workspace is private. Use project_context_search only when automatic context is insufficient.");
    }
    if (event.tool !== "task") return;
    const target = readTarget(output.args) ?? readTarget(event.args);
    if (target !== PROJECT_CONTEXT_MAINTAINER_AGENT_ID) return;
    throw new Error("Do not invoke project-context-maintainer directly. Project Context prepare and update are automatic; use project_context_search only when automatic context is insufficient.");
  };
}
