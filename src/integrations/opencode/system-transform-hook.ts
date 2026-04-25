import { ProjectContextService } from "../../service/project-context-service.js";

const RUNTIME_RULE = [
  "Project Context is available through crewbee-project-context.",
  "Use project_context_prepare when prior project architecture, implementation state, plan, or decisions may affect the task.",
  "Use project_context_search only when prepared context is insufficient.",
  "After material changes, call project_context_finalize with summary, changed files, verification, blockers, and next actions."
].join("\n");

export function createProjectContextSystemTransformHook(service: ProjectContextService) {
  return async (_input: { sessionID?: string; model: unknown }, output: { system: string[] }): Promise<void> => {
    const fragment = await service.detect().then((detection) => detection.found ? service.buildPrimer({ budgetTokens: 700, memoryLimit: 3 }) : null);
    output.system.push(fragment ? `${RUNTIME_RULE}\n\n${fragment.text}` : RUNTIME_RULE);
  };
}
