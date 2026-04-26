import { ProjectContextService } from "../../service/project-context-service.js";
import type { OpenCodeClientLike } from "./types.js";
import { writeRuntimeLog } from "./runtime-log.js";

const RUNTIME_RULE = [
  "Project Context is prepared automatically when needed.",
  "Use project_context_search only if the prepared context is missing or insufficient for prior project decisions, plan, risks, or implementation history."
].join("\n");

const preparedSessions = new Set<string>();

function readParentID(session: unknown): string | undefined {
  if (typeof session !== "object" || session === null || Array.isArray(session)) return undefined;
  const record = session as Record<string, unknown>;
  if (typeof record.parentID === "string") return record.parentID;
  const data = record.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) return readParentID(data);
  return undefined;
}

async function shouldInjectProjectContext(input: { sessionID?: string }, client: OpenCodeClientLike, projectRoot: string): Promise<boolean> {
  if (!input.sessionID) {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "skip-no-session" });
    return false;
  }
  if (!client.session.get) {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "skip-no-session-get", sessionID: input.sessionID });
    return false;
  }
  try {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "session-get-start", sessionID: input.sessionID });
    const session = await client.session.get({ path: { id: input.sessionID }, query: { directory: projectRoot, workspace: projectRoot } });
    const parentID = readParentID(session);
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: parentID === undefined ? "root-session" : "skip-subsession", sessionID: input.sessionID, details: parentID === undefined ? undefined : { parentID } });
    return parentID === undefined;
  } catch (error) {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "session-get-failed", sessionID: input.sessionID, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export function createProjectContextSystemTransformHook(input: { service: ProjectContextService; client: OpenCodeClientLike; projectRoot: string }) {
  return async (hookInput: { sessionID?: string; model: unknown }, output: { system: string[] }): Promise<void> => {
    if (!(await shouldInjectProjectContext(hookInput, input.client, input.projectRoot))) return;
    const sessionID = hookInput.sessionID;
    const shouldPrepare = sessionID !== undefined && !preparedSessions.has(sessionID);
    if (!shouldPrepare) {
      output.system.push(RUNTIME_RULE);
      await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "injected", sessionID: hookInput.sessionID, details: { hasPrimer: false } });
      return;
    }
    const brief = await input.service.prepareContext({ goal: "Prepare automatic project context for the current user task.", budget: "compact" });
    if (sessionID !== undefined) preparedSessions.add(sessionID);
    output.system.push(`${RUNTIME_RULE}\n\n${brief.text}`);
    await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "auto-prepare", sessionID: hookInput.sessionID, details: { estimatedTokens: brief.estimatedTokens, warnings: brief.warnings.length } });
  };
}
