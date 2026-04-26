import type { ProjectContextSearchRequest } from "../../core/types.js";
import { ProjectContextService } from "../../service/project-context-service.js";
import type { CrewBeeProjectContextToolName } from "./tool-definitions.js";

export class CrewBeeProjectContextToolHandlers {
  public constructor(private readonly service: ProjectContextService) {}

  public async execute(name: CrewBeeProjectContextToolName | string, input: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
      case "project_context_search":
        return this.service.searchProjectContext(this.toSearchInput(input));
      default:
        throw new Error(`Unknown CrewBee Project Context tool: ${name}`);
    }
  }

  private toSearchInput(input: Record<string, unknown>): ProjectContextSearchRequest {
    const request: ProjectContextSearchRequest = { goal: this.readString(input, "goal", this.readString(input, "query", "")) };
    const budget = this.readBudget(input);
    if (budget !== undefined) request.budget = budget;
    return request;
  }

  private readString(input: Record<string, unknown>, key: string, fallback: string): string {
    return typeof input[key] === "string" ? input[key] : fallback;
  }

  private readBudget(input: Record<string, unknown>): "compact" | "normal" | undefined {
    const value = input.budget;
    return value === "compact" || value === "normal" ? value : undefined;
  }
}
