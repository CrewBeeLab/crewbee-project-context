import type { FinalizeResult, PrepareContextRequest, ProjectContextBrief, ProjectContextSearchRequest, SessionSummary } from "../core/types.js";
import { ProjectContextService } from "../service/project-context-service.js";

export class ProjectContextMaintainer {
  public constructor(private readonly service: ProjectContextService) {}

  public prepare(request: PrepareContextRequest): Promise<ProjectContextBrief> {
    return this.service.prepareContext(request);
  }

  public search(request: ProjectContextSearchRequest): Promise<ProjectContextBrief> {
    return this.service.searchProjectContext(request);
  }

  public finalizeRequest(summary: SessionSummary = {}): Promise<FinalizeResult> {
    return this.service.finalizeSession(summary);
  }
}
