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
    const includeExtended = options.includeExtended === true;
    const includeProject = options.includeProject !== false;
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

    const [projectText, stateText, planText, handoffText, implementationText, memoryText, architectureText, decisionsText] = await Promise.all([
      includeProject ? maybeRead("PROJECT.md") : Promise.resolve(""),
      maybeRead("STATE.yaml"),
      maybeRead("PLAN.yaml"),
      maybeRead("HANDOFF.md"),
      maybeRead("IMPLEMENTATION.md"),
      maybeRead("MEMORY_INDEX.md"),
      includeExtended ? maybeRead("ARCHITECTURE.md") : Promise.resolve(""),
      includeExtended ? maybeRead("DECISIONS.md") : Promise.resolve("")
    ]);

    const state = this.parser.parseState(stateText);
    const activeStepTitle = state.activeStepId ? this.parser.parsePlanStepTitle(planText, state.activeStepId) : null;
    const memories = this.rankMemories(this.parser.parseMemoryEntries(memoryText, Math.max(memoryLimit, 8)), options.goal).slice(0, memoryLimit);
    const projectName = this.extractProjectName(projectText) ?? state.projectId ?? "unknown project";
    const planWindow = this.planWindow(planText, state.activeStepId);
    const exactNextActions = this.parser.parseMarkdownSectionItems(handoffText, "Exact Next Actions");
    const nextActions = exactNextActions.length > 0 ? exactNextActions : state.nextActions;
    const currentSnapshot = this.parser.parseMarkdownSectionText(handoffText, "Current Snapshot");
    const handoffBlockers = this.parser.parseMarkdownSectionItems(handoffText, "Open Blockers");
    const implementationHighlights = this.sectionBullets(implementationText, ["What Works", "Important Paths", "Known Gaps", "Runtime Flow", "Last Verified"], 8);
    const architectureHighlights = includeExtended ? this.sectionBullets(architectureText, ["System Map", "Module Responsibilities", "Key Invariants", "Failure Handling"], 6) : [];
    const decisionHighlights = includeExtended ? this.recentBullets(decisionsText, 5) : [];
    const lines = [
      "Project Context Brief",
      "Project Context: available",
      "",
      options.goal ? "Goal:" : undefined,
      options.goal ? `- ${options.goal}` : undefined,
      "",
      "Current:",
      `- Project: ${projectName}`,
      `- Project ID: ${state.projectId ?? "unknown"}`,
      `- Active step: ${state.activeStepId ?? "unknown"}${activeStepTitle ? ` �?${activeStepTitle}` : ""}`,
      `- Status: ${state.runStatus ?? "unknown"}`,
      `- Last checkpoint: ${state.lastCheckpoint ?? "unknown"}`,
      `- Blockers: ${state.blockers.length > 0 ? state.blockers.join("; ") : "none"}`,
      ...(planWindow.length > 0 ? planWindow.map((item) => `- ${item}`) : []),
      ...(handoffBlockers.length > 0 ? handoffBlockers.map((item) => `- Open blocker: ${item}`) : []),
      ...(currentSnapshot ? ["", "Current snapshot:", this.firstLines(currentSnapshot, 4)] : []),
      "",
      "Context access:",
      "- Project Context init, prepare, and update are automatic. Treat project_context_search as a rare fallback only for blocking historical context gaps.",
      "",
      "Current implementation:",
      ...(implementationHighlights.length > 0 ? implementationHighlights.map((item) => `- ${item}`) : ["- No implementation highlights recorded."]),
      ...(architectureHighlights.length > 0 ? ["", "Architecture:", ...architectureHighlights.map((item) => `- ${item}`)] : []),
      ...(decisionHighlights.length > 0 ? ["", "Recent decisions:", ...decisionHighlights.map((item) => `- ${item}`)] : []),
      "",
      "Next actions:",
      ...(nextActions.length > 0 ? nextActions.map((item, index) => `${index + 1}. ${item}`) : ["1. No explicit next action recorded."]),
      "",
      "High-signal memory:",
      ...(memories.length > 0 ? memories.map((entry) => `- ${entry.id ?? "memory"} ${entry.type ?? ""}: ${this.sanitizePrivateWorkspaceText(entry.summary ?? "")}`.trim()) : ["- none recorded"]),
      "",
      "Agent rule: Project Context is initialized, prepared, and updated automatically. Do not call project_context_search unless a concrete historical context gap blocks progress."
    ];
    const text = this.enforceBudget(this.sanitizePrivateWorkspaceText(lines.filter((line): line is string => typeof line === "string").join("\n")), budgetTokens);
    return { text, estimatedTokens: this.estimateTokens(text), warnings: warnings.map((warning) => this.sanitizePrivateWorkspaceText(warning)) };
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
    return text.replace(/`?\.crewbee[\\/]\.prjctxt\/?`?/g, "private Project Context workspace");
  }

  private sectionBullets(markdown: string, headings: string[], limit: number): string[] {
    const result: string[] = [];
    for (const heading of headings) {
      const section = this.parser.parseMarkdownSectionText(markdown, heading);
      if (!section) continue;
      const lines = section.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim()).filter(Boolean);
      for (const line of lines) {
        result.push(`${heading}: ${line}`);
        if (result.length >= limit) return result;
      }
    }
    return result;
  }

  private recentBullets(markdown: string, limit: number): string[] {
    return markdown.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim()).filter((line) => line.length > 0 && !line.startsWith("#")).slice(0, limit);
  }

  private rankMemories(memories: Array<{ id: string | null; type: string | null; summary: string | null }>, goal: string | undefined): Array<{ id: string | null; type: string | null; summary: string | null }> {
    const keywords = new Set((goal ?? "").toLowerCase().split(/[^a-z0-9_\-]+/).filter((word) => word.length >= 4));
    if (keywords.size === 0) return memories;
    return memories
      .map((entry, index) => {
        const haystack = `${entry.id ?? ""} ${entry.type ?? ""} ${entry.summary ?? ""}`.toLowerCase();
        let score = 0;
        for (const keyword of keywords) if (haystack.includes(keyword)) score += 1;
        return { entry, index, score };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((item) => item.entry);
  }

  private planWindow(planText: string, activeStepId: string | null): string[] {
    if (!activeStepId) return [];
    const lines = planText.split(/\r?\n/);
    const steps = lines.map((line, index) => ({ line, index, match: line.match(/^\s*- id:\s*(\S+)\s*$/) })).filter((item): item is { line: string; index: number; match: RegExpMatchArray } => item.match !== null);
    const activeIndex = steps.findIndex((step) => step.match[1] === activeStepId);
    if (activeIndex < 0) return [];
    const activeStep = steps[activeIndex];
    if (!activeStep) return [];
    const result: string[] = [];
    const activeBlock = this.stepBlock(lines, activeStep.index, steps[activeIndex + 1]?.index ?? lines.length);
    const criteria = this.extractPlanList(activeBlock, ["acceptance_criteria", "acceptance", "criteria"]);
    if (criteria.length > 0) result.push(`Active step acceptance: ${criteria.slice(0, 3).join("; ")}`);
    let previousIndex: number | null = null;
    for (let index = activeIndex - 1; index >= 0; index -= 1) {
      const step = steps[index];
      if (step && this.stepStatus(this.stepBlock(lines, step.index, steps[index + 1]?.index ?? lines.length)) === "completed") {
        previousIndex = index;
        break;
      }
    }
    if (previousIndex !== null) {
      const previous = steps[previousIndex];
      if (previous) result.push(`Previous completed step: ${previous.match[1]}${this.stepTitle(this.stepBlock(lines, previous.index, steps[previousIndex + 1]?.index ?? lines.length))}`);
    }
    let nextIndex: number | null = null;
    for (let index = activeIndex + 1; index < steps.length; index += 1) {
      const step = steps[index];
      if (step && this.stepStatus(this.stepBlock(lines, step.index, steps[index + 1]?.index ?? lines.length)) !== "completed") {
        nextIndex = index;
        break;
      }
    }
    if (nextIndex !== null) {
      const next = steps[nextIndex];
      if (next) result.push(`Next candidate step: ${next.match[1]}${this.stepTitle(this.stepBlock(lines, next.index, steps[nextIndex + 1]?.index ?? lines.length))}`);
    }
    return result;
  }

  private stepBlock(lines: string[], start: number, end: number): string[] {
    return lines.slice(start, end);
  }

  private stepTitle(block: string[]): string {
    const match = block.join("\n").match(/^\s+title:\s*(.+)$/m);
    return match?.[1] ? ` �?${match[1].trim()}` : "";
  }

  private stepStatus(block: string[]): string | null {
    const match = block.join("\n").match(/^\s+status:\s*(.+)$/m);
    return match?.[1]?.trim() ?? null;
  }

  private extractPlanList(block: string[], keys: string[]): string[] {
    const result: string[] = [];
    let inList = false;
    for (const line of block) {
      if (keys.some((key) => new RegExp(`^\\s+${key}:`).test(line))) {
        inList = true;
        continue;
      }
      if (inList && /^\s+\w/.test(line) && !/^\s+-\s+/.test(line)) break;
      const match = inList ? line.match(/^\s+-\s+(.+)$/) : null;
      if (match?.[1]) result.push(match[1].trim());
    }
    return result;
  }

  private firstLines(text: string, limit: number): string {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, limit).join("\n");
  }
}
