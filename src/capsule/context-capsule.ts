import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "../core/constants.js";
import type { PrimerOptions, ProjectContextPrimer } from "../core/types.js";
import { ProjectContextParser } from "../indexer/parser.js";
import { FileSystemProjectContextStore } from "../workspace/workspace-store.js";

export class ContextCapsuleBuilder {
  public constructor(
    private readonly store: FileSystemProjectContextStore,
    private readonly parser: ProjectContextParser = new ProjectContextParser()
  ) {}

  public async build(options: PrimerOptions = {}): Promise<ProjectContextPrimer> {
    const budgetTokens = options.budgetTokens ?? 1000;
    const memoryLimit = options.memoryLimit ?? 5;
    const contextDir = this.store.paths.contextDir();
    const warnings: string[] = [];

    const maybeRead = async (fileName: string): Promise<string> => {
      const target = path.join(contextDir, fileName);
      if (!(await this.store.exists(target))) {
        warnings.push(`Missing ${DEFAULT_CONTEXT_DIR}/${fileName}`);
        return "";
      }
      return this.store.readText(target);
    };

    const [projectText, stateText, planText, handoffText, memoryText] = await Promise.all([
      maybeRead("PROJECT.md"),
      maybeRead("STATE.yaml"),
      maybeRead("PLAN.yaml"),
      maybeRead("HANDOFF.md"),
      maybeRead("MEMORY_INDEX.md")
    ]);

    const state = this.parser.parseState(stateText);
    const activeStepTitle = state.activeStepId ? this.parser.parsePlanStepTitle(planText, state.activeStepId) : null;
    const memories = this.parser.parseMemoryEntries(memoryText, memoryLimit);
    const projectName = this.extractProjectName(projectText) ?? state.projectId ?? "unknown project";
    const exactNextActions = this.parser.parseMarkdownSectionItems(handoffText, "Exact Next Actions");
    const nextActions = exactNextActions.length > 0 ? exactNextActions : state.nextActions;
    const lines = [
      "Project Context: available",
      "",
      "Current:",
      `- Project: ${projectName}`,
      `- Project ID: ${state.projectId ?? "unknown"}`,
      `- Active step: ${state.activeStepId ?? "unknown"}${activeStepTitle ? ` — ${activeStepTitle}` : ""}`,
      `- Status: ${state.runStatus ?? "unknown"}`,
      `- Last checkpoint: ${state.lastCheckpoint ?? "unknown"}`,
      `- Blockers: ${state.blockers.length > 0 ? state.blockers.join("; ") : "none"}`,
      "",
      "Context access:",
      "- Use project_context_prepare/search/finalize. Internal workspace details are not part of the main-agent context.",
      "",
      "Next actions:",
      ...(nextActions.length > 0 ? nextActions.map((item, index) => `${index + 1}. ${item}`) : ["1. No explicit next action recorded."]),
      "",
      "High-signal memory:",
      ...(memories.length > 0 ? memories.map((entry) => `- ${entry.id ?? "memory"} ${entry.type ?? ""}: ${this.sanitizePrivateWorkspaceText(entry.summary ?? "")}`.trim()) : ["- none recorded"]),
      "",
      "Agent rule: Use project_context_prepare first and project_context_search only when prepared context is insufficient. Use project_context_finalize after material changes."
    ];
    const text = this.enforceBudget(this.sanitizePrivateWorkspaceText(lines.join("\n")), budgetTokens);
    return { text, estimatedTokens: this.estimateTokens(text), sourceFiles: [], warnings: warnings.map((warning) => this.sanitizePrivateWorkspaceText(warning)) };
  }

  public estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private enforceBudget(text: string, budgetTokens: number): string {
    if (this.estimateTokens(text) <= budgetTokens) return text;
    return `${text.slice(0, Math.max(200, budgetTokens * 4 - 80)).trimEnd()}\n\n[Primer truncated to fit budget]`;
  }

  private extractProjectName(projectText: string): string | null {
    const match = projectText.match(/## Project Name\s+([^#]+)/m);
    return match?.[1] ? match[1].trim().split(/\r?\n/)[0]?.trim() ?? null : null;
  }

  private sanitizePrivateWorkspaceText(text: string): string {
    return text.replace(/`?\.crewbeectxt\/?`?/g, "private Project Context workspace");
  }
}
