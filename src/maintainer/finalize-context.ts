import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "../core/constants.js";
import type { FinalizeResult, ParsedState, SessionSummary } from "../core/types.js";
import { ProjectContextParser } from "../indexer/parser.js";
import { ContextUpdater } from "./apply-patch.js";
import { ProjectContextWorkspace } from "../workspace/bootstrap.js";
import { FileSystemProjectContextStore } from "../workspace/workspace-store.js";

export class SessionFinalizer {
  public constructor(
    private readonly store: FileSystemProjectContextStore,
    private readonly updater: ContextUpdater,
    private readonly parser: ProjectContextParser = new ProjectContextParser()
  ) {}

  public async finalize(summary: SessionSummary = {}): Promise<FinalizeResult> {
    const contextDir = this.store.paths.contextDir();
    const changedFiles: string[] = [];
    const warnings: string[] = [];
    if (!(await this.store.exists(contextDir))) {
      if (!this.hasMaterialProgress(summary)) {
        const doctor = await new ProjectContextWorkspace(this.store, this.parser).validate();
        return {
          ok: false,
          checkpointId: null,
          changedFiles,
          warnings: [`Skipped ${DEFAULT_CONTEXT_DIR}/ bootstrap because finalize_request did not include material project progress.`],
          doctor,
          summary
        };
      }
      const projectName = path.basename(this.store.paths.root) || "Project";
      const projectId = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
      const scaffold = new ProjectContextWorkspace(this.store, this.parser);
      await scaffold.init({ projectId, projectName });
      changedFiles.push(DEFAULT_CONTEXT_DIR);
      warnings.push(`Bootstrapped ${DEFAULT_CONTEXT_DIR}/ during finalize_request.`);
    }

    const statePath = path.join(contextDir, "STATE.yaml");
    const planPath = path.join(contextDir, "PLAN.yaml");
    const handoffPath = path.join(contextDir, "HANDOFF.md");
    const observationsDir = path.join(contextDir, "observations");
    await this.store.ensureDir(observationsDir);

    const state = this.parser.parseState(await this.store.readText(statePath));
    const planText = (await this.store.exists(planPath)) ? await this.store.readText(planPath) : "";
    const checkpointId = await this.nextCheckpointId(observationsDir, state.lastCheckpoint);
    const activeStepTitle = state.activeStepId ? this.parser.parsePlanStepTitle(planText, state.activeStepId) : null;

    await this.store.writeText(path.join(observationsDir, `${checkpointId}.md`), this.renderObservation(checkpointId, summary));
    changedFiles.push(`${DEFAULT_CONTEXT_DIR}/observations/${checkpointId}.md`);

    await this.updater.update({
      target: "state",
      operation: "merge",
      payload: {
        last_checkpoint: checkpointId,
        ...(summary.nextActions && summary.nextActions.length > 0 ? { next_actions: summary.nextActions } : {})
      }
    });
    changedFiles.push(`${DEFAULT_CONTEXT_DIR}/STATE.yaml`);

    await this.store.writeText(handoffPath, this.renderHandoff(checkpointId, state, activeStepTitle, summary));
    changedFiles.push(`${DEFAULT_CONTEXT_DIR}/HANDOFF.md`);

    for (const entry of summary.memoryEntries ?? []) {
      await this.updater.update({ target: "memory", operation: "append", payload: this.renderMemoryEntry(entry) });
    }
    if ((summary.memoryEntries ?? []).length > 0) changedFiles.push(`${DEFAULT_CONTEXT_DIR}/MEMORY_INDEX.md`);
    for (const decision of summary.decisions ?? []) {
      await this.updater.update({ target: "decision", operation: "append", payload: this.renderDecision(decision) });
    }
    if ((summary.decisions ?? []).length > 0) changedFiles.push(`${DEFAULT_CONTEXT_DIR}/DECISIONS.md`);

    const doctor = await new ProjectContextWorkspace(this.store, this.parser).validate();
    const doctorWarnings = doctor.warnings.map((warning) => `doctor warning: ${warning}`);
    const doctorErrors = doctor.errors.map((error) => `doctor error: ${error}`);

    return {
      ok: doctor.ok,
      checkpointId,
      changedFiles: [...new Set(changedFiles)],
      warnings: [...warnings, ...doctorWarnings, ...doctorErrors],
      doctor,
      summary
    };
  }

  private hasMaterialProgress(summary: SessionSummary): boolean {
    if (this.hasText(summary.title) || this.hasText(summary.summary)) return true;
    return [
      summary.changedFiles,
      summary.verification,
      summary.nextActions,
      summary.blockers,
      summary.memoryEntries,
      summary.decisions
    ].some((items) => Array.isArray(items) && items.length > 0);
  }

  private hasText(value: string | undefined): boolean {
    return typeof value === "string" && value.trim().length > 0;
  }

  private async nextCheckpointId(observationsDir: string, lastCheckpoint: string | null): Promise<string> {
    const ids: string[] = [];
    if (lastCheckpoint) ids.push(lastCheckpoint);
    if (await this.store.exists(observationsDir)) {
      for (const entry of await fs.readdir(observationsDir, { withFileTypes: true })) {
        const match = entry.isFile() ? entry.name.match(/^CP-(\d{4})\.md$/) : null;
        if (match?.[1]) ids.push(`CP-${match[1]}`);
      }
    }
    const max = ids.reduce((value, id) => Math.max(value, Number(id.replace("CP-", "")) || 0), 0);
    return `CP-${String(max + 1).padStart(4, "0")}`;
  }

  private renderObservation(checkpointId: string, summary: SessionSummary): string {
    return `# ${checkpointId} ${summary.title ?? "Session Finalize"}\n\n## Summary\n\n${summary.summary ?? "No summary provided."}\n\n## Changed Files\n\n${this.renderList(summary.changedFiles)}\n\n## Verification\n\n${this.renderList(summary.verification)}\n\n## Follow-ups\n\n${this.renderList(summary.nextActions)}\n`;
  }

  private renderHandoff(checkpointId: string, state: ParsedState, activeStepTitle: string | null, summary: SessionSummary): string {
    const activeStep = `${state.activeCycle ?? "unknown"}/${state.activeStepId ?? "unknown"}${activeStepTitle ? ` — ${activeStepTitle}` : ""}`;
    return `# Session Handoff\n\n## Current Snapshot\n\n- Active step: ${activeStep}.\n- Run status: ${state.runStatus ?? "unknown"}.\n- Last checkpoint: ${checkpointId}.\n- Blockers: ${summary.blockers && summary.blockers.length > 0 ? summary.blockers.join("; ") : "none known"}.\n\n## What Changed This Session\n\n${summary.summary ?? "No summary provided."}\n\n## Open Blockers\n\n${this.renderList(summary.blockers, "None known.")}\n\n## Next Session Start Checklist\n\n1. Read this handoff.\n2. Check ${DEFAULT_CONTEXT_DIR}/STATE.yaml and ${DEFAULT_CONTEXT_DIR}/PLAN.yaml.\n3. Use ${DEFAULT_CONTEXT_DIR}/IMPLEMENTATION.md before broad code exploration.\n\n## Exact Next Actions\n\n${this.renderList(summary.nextActions, "No explicit next action recorded.", true)}\n\n## References\n\n- ${DEFAULT_CONTEXT_DIR}/PLAN.yaml\n- ${DEFAULT_CONTEXT_DIR}/STATE.yaml\n- ${DEFAULT_CONTEXT_DIR}/IMPLEMENTATION.md\n- ${DEFAULT_CONTEXT_DIR}/MEMORY_INDEX.md\n`;
  }

  private renderList(items: unknown[] | undefined, empty = "None.", numbered = false): string {
    if (!items || items.length === 0) return numbered ? `1. ${empty}` : `- ${empty}`;
    return items.map((item, index) => {
      const text = typeof item === "string" ? item : this.readItemSummary(item);
      return numbered ? `${index + 1}. ${text}` : `- ${text}`;
    }).join("\n");
  }

  private readItemSummary(item: unknown): string {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return String(item);
    const record = item as Record<string, unknown>;
    if (typeof record.action === "string") return record.action;
    if (typeof record.summary === "string") return record.summary;
    return JSON.stringify(record);
  }

  private renderMemoryEntry(entry: Record<string, string>): string {
    return `- ID: ${entry.id ?? "M-TBD"}\n  Type: ${entry.type ?? "discovery"}\n  Summary: ${entry.summary ?? "TBD"}\n  Affects: ${entry.affects ?? "TBD"}\n  References: ${entry.references ?? `${DEFAULT_CONTEXT_DIR}/observations`}`;
  }

  private renderDecision(decision: Record<string, string>): string {
    return `## ${decision.id ?? "D-TBD"}\n\n- Status: ${decision.status ?? "proposed"}\n- Context: ${decision.context ?? "TBD"}\n- Decision: ${decision.decision ?? "TBD"}\n- Consequences:\n  - ${decision.consequences ?? "TBD"}`;
  }
}
