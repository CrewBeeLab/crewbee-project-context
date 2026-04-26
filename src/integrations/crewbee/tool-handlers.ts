import type { PrepareContextRequest, ProjectContextSearchRequest } from "../../core/types.js";
import { ProjectContextService } from "../../service/project-context-service.js";
import type { CrewBeeProjectContextToolName } from "./tool-definitions.js";

export class CrewBeeProjectContextToolHandlers {
  public constructor(private readonly service: ProjectContextService) {}

  public async execute(name: CrewBeeProjectContextToolName | string, input: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
      case "project_context_prepare":
        return this.service.prepareContext(this.toPrepareInput(input));
      case "project_context_search":
        return this.service.searchProjectContext(this.toSearchInput(input));
      case "project_context_update":
        return this.service.finalizeSession(this.toUpdateInput(input));
      case "project_context_finalize":
        return this.service.finalizeSession(this.toFinalizeInput(input));
      default:
        throw new Error(`Unknown CrewBee Project Context tool: ${name}`);
    }
  }

  private toFinalizeInput(input: Record<string, unknown>): Parameters<ProjectContextService["finalizeSession"]>[0] {
    const summary: Parameters<ProjectContextService["finalizeSession"]>[0] = {};
    const title = this.optionalString(input, "title");
    const summaryText = this.optionalString(input, "summary");
    const changedFiles = this.stringArray(input, "changedFiles") ?? this.stringArray(input, "changed_files");
    const verification = this.stringArray(input, "verification");
    const nextActions = this.stringArray(input, "nextActions") ?? this.stringArray(input, "next_actions");
    const blockers = this.stringArray(input, "blockers");
    if (title !== undefined) summary.title = title;
    if (summaryText !== undefined) summary.summary = summaryText;
    if (changedFiles !== undefined) summary.changedFiles = changedFiles;
    if (verification !== undefined) summary.verification = verification;
    if (nextActions !== undefined) summary.nextActions = nextActions;
    if (blockers !== undefined) summary.blockers = blockers;
    return summary;
  }

  private toUpdateInput(input: Record<string, unknown>): Parameters<ProjectContextService["finalizeSession"]>[0] {
    const goal = this.readString(input, "goal", this.readString(input, "summary", "Update project context."));
    const facts = this.stringArray(input, "facts") ?? [];
    const evidence = this.stringArray(input, "evidence") ?? [];
    return {
      title: "Project Context Update",
      summary: [goal, ...facts.map((fact) => `Fact: ${fact}`), ...evidence.map((item) => `Evidence: ${item}`)].join("\n")
    };
  }

  private toPrepareInput(input: Record<string, unknown>): PrepareContextRequest {
    const request: PrepareContextRequest = { goal: this.readString(input, "goal", "Prepare project context.") };
    const taskType = this.optionalString(input, "task_type");
    const budget = this.readBudget(input);
    if (taskType !== undefined) request.taskType = taskType;
    if (budget !== undefined) request.budget = budget;
    return request;
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

  private optionalString(input: Record<string, unknown>, key: string): string | undefined {
    return typeof input[key] === "string" ? input[key] : undefined;
  }

  private readBudget(input: Record<string, unknown>): "compact" | "normal" | undefined {
    const value = input.budget;
    return value === "compact" || value === "normal" ? value : undefined;
  }

  private stringArray(input: Record<string, unknown>, key: string): string[] | undefined {
    const value = input[key];
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
  }
}
