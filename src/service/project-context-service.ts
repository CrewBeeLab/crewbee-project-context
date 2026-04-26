import type { ContextPatch, ContextSearchResult, ContextUpdateResult, DetectionResult, FinalizeResult, InitOptions, InitResult, PrepareContextRequest, PrimerOptions, ProjectContextBrief, ProjectContextPrimer, ProjectContextSearchRequest, SessionSummary, ValidationResult } from "../core/types.js";
import { ContextCapsuleBuilder } from "../capsule/context-capsule.js";
import { ProjectContextParser } from "../indexer/parser.js";
import { ContextUpdater } from "../maintainer/apply-patch.js";
import { SessionFinalizer } from "../maintainer/finalize-context.js";
import { ContextSearcher } from "../maintainer/search-context.js";
import { ProjectContextWorkspace } from "../workspace/bootstrap.js";
import { FileSystemProjectContextStore } from "../workspace/workspace-store.js";

export class ProjectContextService {
  private readonly store: FileSystemProjectContextStore;
  private readonly workspace: ProjectContextWorkspace;
  private readonly capsule: ContextCapsuleBuilder;
  private readonly searcher: ContextSearcher;
  private readonly updater: ContextUpdater;
  private readonly finalizer: SessionFinalizer;

  public constructor(root: string = process.cwd()) {
    this.store = new FileSystemProjectContextStore(root);
    const parser = new ProjectContextParser();
    this.updater = new ContextUpdater(this.store);
    this.workspace = new ProjectContextWorkspace(this.store, parser);
    this.capsule = new ContextCapsuleBuilder(this.store, parser);
    this.searcher = new ContextSearcher(this.store);
    this.finalizer = new SessionFinalizer(this.store, this.updater, parser);
  }

  public detect(): Promise<DetectionResult> {
    return this.store.detect();
  }

  public initProjectContext(options?: InitOptions): Promise<InitResult> {
    return this.workspace.init(options);
  }

  public validateContext(): Promise<ValidationResult> {
    return this.workspace.validate();
  }

  public buildPrimer(options?: PrimerOptions): Promise<ProjectContextPrimer> {
    return this.capsule.build(options);
  }

  public async prepareContext(request: PrepareContextRequest): Promise<ProjectContextBrief> {
    const detection = await this.detect();
    if (!detection.found) {
      const text = [
        "Project Context Brief",
        "- No persisted project context is available yet.",
        "- Continue with normal code exploration.",
        "- Project Context will update automatically when there is project context worth preserving."
      ].join("\n");
      return { text, estimatedTokens: this.estimateTokens(text), warnings: [] };
    }
    const useExtendedContext = request.budget === "normal";
    const primer = await this.capsule.build({ budgetTokens: this.prepareBudgetTokens(request.budget), includeProject: useExtendedContext, includeExtended: useExtendedContext, goal: request.goal });
    return {
      text: primer.text,
      estimatedTokens: primer.estimatedTokens,
      warnings: primer.warnings
    };
  }

  public async searchProjectContext(request: ProjectContextSearchRequest): Promise<ProjectContextBrief> {
    const result = await this.searcher.search(request.goal, { limit: 5 });
    const findings = result.items.length > 0
      ? result.items.map((item, index) => `${index + 1}. ${item.excerpt}`).join("\n")
      : "No relevant project context found.";
    const text = `Project Context Search Result\n\nGoal:\n- ${request.goal}\n\nFindings:\n${findings}\n\nConfidence:\n- ${result.items.length > 0 ? "Medium" : "Low"}`;
    return { text, estimatedTokens: this.estimateTokens(text), warnings: [] };
  }

  public estimateTokens(text: string): number {
    return this.capsule.estimateTokens(text);
  }

  public searchContext(query: string, options?: { limit?: number }): Promise<ContextSearchResult> {
    return this.searcher.search(query, options);
  }

  public updateContext(patch: ContextPatch): Promise<ContextUpdateResult> {
    return this.updater.update(patch);
  }

  public finalizeSession(summary?: SessionSummary): Promise<FinalizeResult> {
    return this.finalizer.finalize(summary);
  }

  private prepareBudgetTokens(budget: PrepareContextRequest["budget"]): number {
    if (budget === "normal") return 1200;
    return 1000;
  }
}
