import { readFile } from "node:fs/promises";
import path from "node:path";
import { PRIVATE_RUNTIME_CONTEXT_DIR } from "../../core/constants.js";
import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import { hasSessionMethod, sessionGet } from "./client-adapter.js";
import { containsPrivateContextAccess, isProjectContextMaintainer } from "./visibility.js";
import type { OpenCodeClientLike } from "./types.js";
import { writeRuntimeLog } from "./runtime-log.js";

const PROJECT_CONTEXT_TOOL_NAMES = new Set(["project_context_search"]);

function readTarget(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  const value = record.subagent_type ?? record.agent ?? record.subagent;
  return typeof value === "string" ? value : undefined;
}

function isProjectContextUpdateSubtask(args: unknown): boolean {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return false;
  const record = args as Record<string, unknown>;
  const target = record.subagent_type ?? record.agent ?? record.subagent;
  const prompt = record.prompt;
  return target === PROJECT_CONTEXT_MAINTAINER_AGENT_ID && (record.command === "project_context_update" || (typeof prompt === "string" && /Project Context Maintainer job: update\s+Job ID:/i.test(prompt)));
}

function isProjectContextTool(tool: string): boolean {
  return PROJECT_CONTEXT_TOOL_NAMES.has(tool);
}

function readParentID(session: unknown): string | undefined {
  if (typeof session !== "object" || session === null || Array.isArray(session)) return undefined;
  const record = session as Record<string, unknown>;
  if (typeof record.parentID === "string") return record.parentID;
  for (const key of ["data", "info", "properties", "session", "message"]) {
    const nested = record[key];
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      const parentID = readParentID(nested);
      if (parentID !== undefined) return parentID;
    }
  }
  return undefined;
}

async function isSubsession(client: OpenCodeClientLike | undefined, sessionID: string, projectRoot: string | undefined): Promise<boolean> {
  if (!client || !hasSessionMethod(client, "get")) return false;
  const query = projectRoot ? { directory: projectRoot, workspace: projectRoot } : undefined;
  const session = await sessionGet(client, { sessionID, ...(query ? { query } : {}) });
  return readParentID(session) !== undefined;
}

function findRuntimeUpdateJobID(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\", "/");
    const match = normalized.match(/\.crewbee\/\.prjctxt\/cache\/update-jobs\/(pcu_[a-z0-9_]+)\.json/i);
    return match?.[1];
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const jobID = findRuntimeUpdateJobID(item);
      if (jobID) return jobID;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  for (const [key, item] of Object.entries(value)) {
    const jobID = findRuntimeUpdateJobID(key) ?? findRuntimeUpdateJobID(item);
    if (jobID) return jobID;
  }
  return undefined;
}

async function parentSessionID(client: OpenCodeClientLike | undefined, sessionID: string, projectRoot: string | undefined): Promise<string | undefined> {
  if (!client || !hasSessionMethod(client, "get")) return undefined;
  const query = projectRoot ? { directory: projectRoot, workspace: projectRoot } : undefined;
  const session = await sessionGet(client, { sessionID, ...(query ? { query } : {}) });
  return readParentID(session);
}

async function isPersistedUpdateJobForParent(projectRoot: string | undefined, parentID: string | undefined, jobID: string | undefined): Promise<boolean> {
  if (!projectRoot || !parentID || !jobID) return false;
  try {
    const payloadPath = path.join(projectRoot, PRIVATE_RUNTIME_CONTEXT_DIR, "cache", "update-jobs", `${jobID}.json`);
    const payload = JSON.parse(await readFile(payloadPath, "utf8")) as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
    const parentSession = (payload as Record<string, unknown>).parentSession;
    if (typeof parentSession !== "object" || parentSession === null || Array.isArray(parentSession)) return false;
    return (parentSession as Record<string, unknown>).id === parentID;
  } catch {
    return false;
  }
}

export function createProjectContextToolGuard(options: { client?: OpenCodeClientLike; projectRoot?: string; isRuntimeUpdateTask?: (sessionID: string, args: unknown) => boolean; isActiveUpdateJob?: (sessionID: string, jobID: string) => boolean; isMaintainerSession?: (sessionID: string) => boolean; markMaintainerSession?: (sessionID: string) => void; markRuntimeUpdateMaintainerSession?: (input: { sessionID: string; parentSessionID: string; jobID: string }) => void } = {}) {
  return async (event: { tool: string; sessionID: string; agent?: string; args?: unknown }, output: { args?: unknown }): Promise<void> => {
    if (options.projectRoot) await writeRuntimeLog(options.projectRoot, { component: "tool-guard", event: "tool-before", sessionID: event.sessionID, agent: event.agent, tool: event.tool });
    const runtimeMaintainerSession = options.isMaintainerSession?.(event.sessionID) === true;
    if (isProjectContextTool(event.tool)) {
      if (isProjectContextMaintainer(event.agent) || runtimeMaintainerSession) {
        if (options.projectRoot) await writeRuntimeLog(options.projectRoot, { component: "tool-guard", event: "block-maintainer-recursion", sessionID: event.sessionID, agent: event.agent, tool: event.tool });
        throw new Error("Project Context Maintainer must not call project_context_search recursively.");
      }
      if (await isSubsession(options.client, event.sessionID, options.projectRoot)) {
        if (options.projectRoot) await writeRuntimeLog(options.projectRoot, { component: "tool-guard", event: "block-subsession-project-context-tool", sessionID: event.sessionID, agent: event.agent, tool: event.tool });
        throw new Error("Project Context tools are available only to root primary-agent sessions, not subsessions or subagents.");
      }
      if (options.projectRoot) await writeRuntimeLog(options.projectRoot, { component: "tool-guard", event: "allow-project-context-tool", sessionID: event.sessionID, agent: event.agent, tool: event.tool });
    }
    if (isProjectContextMaintainer(event.agent) || runtimeMaintainerSession) {
      const jobID = findRuntimeUpdateJobID(event.args) ?? findRuntimeUpdateJobID(output.args);
      const parentID = jobID ? await parentSessionID(options.client, event.sessionID, options.projectRoot) : undefined;
      if (jobID && parentID && (options.isActiveUpdateJob?.(parentID, jobID) === true || await isPersistedUpdateJobForParent(options.projectRoot, parentID, jobID))) {
        options.markMaintainerSession?.(event.sessionID);
        options.markRuntimeUpdateMaintainerSession?.({ sessionID: event.sessionID, parentSessionID: parentID, jobID });
        if (options.projectRoot) await writeRuntimeLog(options.projectRoot, { component: "tool-guard", event: "allow-runtime-update-maintainer", sessionID: event.sessionID, details: { parentID, jobID } });
      }
      return;
    }
    if (containsPrivateContextAccess(event.args) || containsPrivateContextAccess(output.args)) {
      const jobID = findRuntimeUpdateJobID(event.args) ?? findRuntimeUpdateJobID(output.args);
      const parentID = jobID ? await parentSessionID(options.client, event.sessionID, options.projectRoot) : undefined;
      if (jobID && parentID && (options.isActiveUpdateJob?.(parentID, jobID) === true || await isPersistedUpdateJobForParent(options.projectRoot, parentID, jobID))) {
        options.markMaintainerSession?.(event.sessionID);
        options.markRuntimeUpdateMaintainerSession?.({ sessionID: event.sessionID, parentSessionID: parentID, jobID });
        if (options.projectRoot) await writeRuntimeLog(options.projectRoot, { component: "tool-guard", event: "allow-runtime-update-maintainer", sessionID: event.sessionID, details: { parentID, jobID } });
        return;
      }
      throw new Error("Project Context workspace is private. Do not access it directly; project_context_search is a rare fallback only for blocking historical context gaps.");
    }
    if (event.tool !== "task") return;
    if ((isProjectContextUpdateSubtask(output.args) && options.isRuntimeUpdateTask?.(event.sessionID, output.args) === true) || (isProjectContextUpdateSubtask(event.args) && options.isRuntimeUpdateTask?.(event.sessionID, event.args) === true)) return;
    const target = readTarget(output.args) ?? readTarget(event.args);
    if (target !== PROJECT_CONTEXT_MAINTAINER_AGENT_ID) return;
    throw new Error("Do not invoke project-context-maintainer directly. Project Context init, prepare, and update are automatic; project_context_search is a rare fallback only for blocking historical context gaps.");
  };
}
