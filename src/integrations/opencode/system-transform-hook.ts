import { ProjectContextService } from "../../service/project-context-service.js";
import type { OpenCodeClientLike } from "./types.js";

const RUNTIME_RULE = [
  "Project Context is available through crewbee-project-context.",
  "Use project_context_prepare when prior project architecture, implementation state, plan, or decisions may affect the task.",
  "Use project_context_search only when prepared context is insufficient.",
  "After material changes, call project_context_finalize with summary, changed files, verification, blockers, and next actions."
].join("\n");

function readParentID(session: unknown): string | undefined {
  if (typeof session !== "object" || session === null || Array.isArray(session)) return undefined;
  const record = session as Record<string, unknown>;
  if (typeof record.parentID === "string") return record.parentID;
  const data = record.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) return readParentID(data);
  return undefined;
}

async function shouldInjectProjectContext(input: { sessionID?: string }, client: OpenCodeClientLike): Promise<boolean> {
  if (!input.sessionID || !client.session.get) return false;
  const session = await client.session.get({ path: { id: input.sessionID } });
  return readParentID(session) === undefined;
}

export function createProjectContextSystemTransformHook(input: { service: ProjectContextService; client: OpenCodeClientLike }) {
  return async (hookInput: { sessionID?: string; model: unknown }, output: { system: string[] }): Promise<void> => {
    if (!(await shouldInjectProjectContext(hookInput, input.client))) return;
    const fragment = await input.service.detect().then((detection) => detection.found ? input.service.buildPrimer({ budgetTokens: 700, memoryLimit: 3 }) : null);
    output.system.push(fragment ? `${RUNTIME_RULE}\n\n${fragment.text}` : RUNTIME_RULE);
  };
}
