import type { CrewBeePromptFragment } from "../../core/types.js";
import { ProjectContextService } from "../../service/project-context-service.js";
import { PROJECT_CONTEXT_MAINTAINER_AGENT } from "./internal-agent.js";
import { buildCrewBeeProjectContextPromptFragment } from "./prompt-fragment.js";
import { CREWBEE_PROJECT_CONTEXT_TOOL_NAMES, type CrewBeeProjectContextToolName } from "./tool-definitions.js";
import { CrewBeeProjectContextToolHandlers } from "./tool-handlers.js";

export class CrewBeeProjectContextExtension {
  private readonly handlers: CrewBeeProjectContextToolHandlers;

  public constructor(private readonly service: ProjectContextService) {
    this.handlers = new CrewBeeProjectContextToolHandlers(service);
  }

  public buildPromptFragment(): Promise<CrewBeePromptFragment> {
    return buildCrewBeeProjectContextPromptFragment(this.service);
  }

  public getToolNames(): CrewBeeProjectContextToolName[] {
    return [...CREWBEE_PROJECT_CONTEXT_TOOL_NAMES];
  }

  public executeTool(name: CrewBeeProjectContextToolName | string, input: Record<string, unknown> = {}): Promise<unknown> {
    return this.handlers.execute(name, input);
  }

  public getInternalAgent() {
    return PROJECT_CONTEXT_MAINTAINER_AGENT;
  }
}

export { CrewBeeProjectContextExtension as CrewBeeProjectContextBridge };
