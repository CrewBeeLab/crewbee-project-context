export { DEFAULT_CONTEXT_DIR, REQUIRED_CONTEXT_FILES, SEARCHABLE_CONTEXT_FILES } from "./core/constants.js";
export { ProjectContextError, UnsafeContextPathError } from "./core/errors.js";
export type * from "./core/types.js";
export { CrewBeeProjectContextBridge, CrewBeeProjectContextExtension } from "./integrations/crewbee/extension.js";
export { PROJECT_CONTEXT_MAINTAINER_AGENT } from "./integrations/crewbee/internal-agent.js";
export { CREWBEE_PROJECT_CONTEXT_TOOL_NAMES } from "./integrations/crewbee/tool-definitions.js";
export { ProjectContextMaintainer } from "./maintainer/project-context-maintainer.js";
export { ProjectContextService } from "./service/project-context-service.js";

import type { ContextPatch, PrepareContextRequest, PrimerOptions, ProjectContextSearchRequest, SessionSummary } from "./core/types.js";
import { CrewBeeProjectContextExtension } from "./integrations/crewbee/extension.js";
import { ProjectContextService } from "./service/project-context-service.js";

const service = (root?: string): ProjectContextService => new ProjectContextService(root);
const extension = (root?: string): CrewBeeProjectContextExtension => new CrewBeeProjectContextExtension(service(root));

export function detect(root?: string) {
  return service(root).detect();
}

export function initProjectContext(root?: string, options = {}) {
  return service(root).initProjectContext(options);
}

export function validateContext(root?: string) {
  return service(root).validateContext();
}

export function buildPrimer(root?: string, options?: PrimerOptions) {
  return service(root).buildPrimer(options);
}

export function estimateTokens(text: string) {
  return service().estimateTokens(text);
}

export function searchContext(root: string | undefined, query: string, options?: { limit?: number }) {
  return service(root).searchContext(query, options);
}

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

export function readContextFile(root: string | undefined, requestedPath: string) {
  return service(root).readContextFile(requestedPath);
}

export function updateContext(root: string | undefined, patch: ContextPatch) {
  return service(root).updateContext(patch);
}

export function finalizeSession(root?: string, summary?: SessionSummary) {
  return service(root).finalizeSession(summary);
}

export function requestProjectContextFinalize(root?: string, summary?: SessionSummary) {
  return service(root).finalizeSession(summary);
}

export function buildCrewBeePromptFragment(root?: string, options?: PrimerOptions) {
  return extension(root).buildPromptFragment();
}

export function getCrewBeeToolNames() {
  return extension().getToolNames();
}

export function executeCrewBeeProjectContextTool(root: string | undefined, name: string, input?: Record<string, unknown>) {
  return extension(root).executeTool(name, input);
}
