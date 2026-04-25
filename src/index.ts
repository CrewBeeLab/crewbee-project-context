export type {
  ContextBudget,
  CrewBeePromptFragment,
  FinalizeResult,
  PrepareContextRequest,
  ProjectContextBrief,
  ProjectContextSearchRequest,
  SessionSummary
} from "./core/types.js";
export { CrewBeeProjectContextBridge, CrewBeeProjectContextExtension } from "./integrations/crewbee/extension.js";
export { PROJECT_CONTEXT_MAINTAINER_AGENT } from "./integrations/crewbee/internal-agent.js";
export { CREWBEE_PROJECT_CONTEXT_TOOL_NAMES } from "./integrations/crewbee/tool-definitions.js";
export { ProjectContextOpenCodePlugin } from "./integrations/opencode/plugin.js";

import type { PrepareContextRequest, ProjectContextSearchRequest, SessionSummary } from "./core/types.js";
import { CrewBeeProjectContextExtension } from "./integrations/crewbee/extension.js";
import { ProjectContextService } from "./service/project-context-service.js";

const service = (root?: string): ProjectContextService => new ProjectContextService(root);
const extension = (root?: string): CrewBeeProjectContextExtension => new CrewBeeProjectContextExtension(service(root));

export function prepareProjectContext(root: string | undefined, goal: string, options?: { taskType?: string; budget?: "compact" | "normal" | "deep" }) {
  const request: PrepareContextRequest = { goal };
  if (options?.taskType !== undefined) request.taskType = options.taskType;
  if (options?.budget !== undefined) request.budget = options.budget;
  return service(root).prepareContext(request);
}

export function searchProjectContext(root: string | undefined, goal: string, options?: { budget?: "compact" | "normal" | "deep" }) {
  const request: ProjectContextSearchRequest = { goal };
  if (options?.budget !== undefined) request.budget = options.budget;
  return service(root).searchProjectContext(request);
}

export function requestProjectContextFinalize(root?: string, summary?: SessionSummary) {
  return service(root).finalizeSession(summary);
}

export function createCrewBeeProjectContextExtension(root?: string) {
  return extension(root);
}

export function buildCrewBeePromptFragment(root?: string) {
  return extension(root).buildPromptFragment();
}

export function getCrewBeeToolNames() {
  return extension().getToolNames();
}

export function executeCrewBeeProjectContextTool(root: string | undefined, name: string, input?: Record<string, unknown>) {
  return extension(root).executeTool(name, input);
}
