import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONTEXT_DIR, REQUIRED_CONTEXT_FILES } from "../core/constants.js";
import type { InitOptions, InitResult, ValidationResult } from "../core/types.js";
import { ProjectContextParser } from "../indexer/parser.js";
import { FileSystemProjectContextStore } from "./workspace-store.js";

const TEMPLATE_DIR = new URL("../../templates/crewbeectxt-template/", import.meta.url);

export class ProjectContextWorkspace {
  public constructor(
    private readonly store: FileSystemProjectContextStore,
    private readonly parser: ProjectContextParser = new ProjectContextParser()
  ) {}

  public async init(options: InitOptions = {}): Promise<InitResult> {
    const contextDir = this.store.paths.contextDir();
    const templates = await this.readTemplates(options);
    const created: string[] = [];
    const skipped: string[] = [];

    await this.store.ensureDir(contextDir);
    await this.store.ensureDir(path.join(contextDir, "observations"));
    await this.store.ensureDir(path.join(contextDir, "cache"));

    for (const [fileName, content] of Object.entries(templates)) {
      const target = path.join(contextDir, fileName);
      const relative = `${DEFAULT_CONTEXT_DIR}/${fileName}`;
      if (!options.force && (await this.store.exists(target))) {
        skipped.push(relative);
        continue;
      }
      await this.store.writeText(target, content);
      created.push(relative);
    }

    return { root: this.store.paths.root, contextDir, created, skipped };
  }

  public async validate(): Promise<ValidationResult> {
    const contextDir = this.store.paths.contextDir();
    const errors: string[] = [];
    const warnings: string[] = [];
    const checked: string[] = [];

    if (!(await this.store.exists(contextDir))) {
      errors.push(`Missing context directory: ${DEFAULT_CONTEXT_DIR}`);
      return { ok: false, errors, warnings, checked };
    }

    for (const fileName of REQUIRED_CONTEXT_FILES) {
      const target = path.join(contextDir, fileName);
      checked.push(`${DEFAULT_CONTEXT_DIR}/${fileName}`);
      if (!(await this.store.exists(target))) {
        errors.push(`Missing required context file: ${DEFAULT_CONTEXT_DIR}/${fileName}`);
      }
    }

    if (errors.length === 0) {
      await this.validateContent(contextDir, errors, warnings);
    }

    return { ok: errors.length === 0, errors, warnings, checked };
  }

  private async readTemplates(options: InitOptions): Promise<Record<string, string>> {
    const projectId = options.projectId ?? "new-project";
    const projectName = options.projectName ?? "New Project";
    const entries = await fs.readdir(TEMPLATE_DIR, { withFileTypes: true });
    const templates: Record<string, string> = {};
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const text = await this.store.readText(new URL(entry.name, TEMPLATE_DIR));
      templates[entry.name] = text
        .replaceAll("new-project", projectId)
        .replaceAll("New Project", projectName);
    }
    return templates;
  }

  private async validateContent(contextDir: string, errors: string[], warnings: string[]): Promise<void> {
    const stateText = await this.store.readText(path.join(contextDir, "STATE.yaml"));
    const planText = await this.store.readText(path.join(contextDir, "PLAN.yaml"));
    const handoffText = await this.store.readText(path.join(contextDir, "HANDOFF.md"));
    const implementationText = await this.store.readText(path.join(contextDir, "IMPLEMENTATION.md"));
    const state = this.parser.parseState(stateText);
    const plan = this.parser.parsePlan(planText);

    this.requireScalar(errors, "STATE.yaml", state.projectId, "project_id");
    this.requireScalar(errors, "STATE.yaml", state.runStatus, "run_status");
    this.requireScalar(errors, "STATE.yaml", state.activeCycle, "active_cycle");
    this.requireScalar(errors, "STATE.yaml", state.activeStepId, "active_step_id");
    this.requireScalar(errors, "PLAN.yaml", plan.projectId, "project_id");

    if (plan.cycleIds.length === 0) errors.push("PLAN.yaml must contain at least one cycle id");
    if (plan.stepIds.length === 0) errors.push("PLAN.yaml must contain at least one step id");
    if (new Set(plan.stepIds).size !== plan.stepIds.length) errors.push("PLAN.yaml contains duplicate step ids");
    if (state.projectId && plan.projectId && state.projectId !== plan.projectId) {
      errors.push(`STATE.yaml project_id '${state.projectId}' does not match PLAN.yaml project_id '${plan.projectId}'`);
    }
    if (state.activeCycle && !plan.cycleIds.includes(state.activeCycle)) {
      errors.push(`STATE.yaml active_cycle '${state.activeCycle}' is not present in PLAN.yaml`);
    }
    if (state.activeStepId && !plan.stepIds.includes(state.activeStepId)) {
      errors.push(`STATE.yaml active_step_id '${state.activeStepId}' is not present in PLAN.yaml`);
    }
    if (state.nextActions.length === 0) warnings.push("STATE.yaml has no next_actions entries");
    if (!this.hasSection(handoffText, "Current Snapshot")) errors.push("HANDOFF.md must contain a '## Current Snapshot' section");
    if (this.parser.parseMarkdownSectionItems(handoffText, "Exact Next Actions").length === 0) {
      errors.push("HANDOFF.md must contain non-empty '## Exact Next Actions' items");
    }
    if (!this.hasSection(implementationText, "Verification Commands")) {
      warnings.push("IMPLEMENTATION.md should contain a '## Verification Commands' section");
    }
  }

  private requireScalar(errors: string[], fileName: string, value: string | null, yamlKey: string): void {
    if (!value) errors.push(`${fileName} is missing ${yamlKey}`);
  }

  private hasSection(markdown: string, heading: string): boolean {
    return markdown.split(/\r?\n/).some((line) => line.trim() === `## ${heading}`);
  }
}
