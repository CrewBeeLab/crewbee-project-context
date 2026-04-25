import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "../core/constants.js";
import { getContextDir } from "../core/path.js";
import { parsePlanStepTitle, parseState } from "../indexer/parse.js";
import { ensureDir, pathExists, readText, writeText } from "../store/file-system-store.js";
import { updateContext } from "../update/update-context.js";

export async function finalizeSession(root = process.cwd(), summary = {}, options = {}) {
  const contextDir = options.contextDir ?? DEFAULT_CONTEXT_DIR;
  const absoluteContextDir = getContextDir(root, contextDir);
  const statePath = path.join(absoluteContextDir, "STATE.yaml");
  const planPath = path.join(absoluteContextDir, "PLAN.yaml");
  const handoffPath = path.join(absoluteContextDir, "HANDOFF.md");
  const observationsDir = path.join(absoluteContextDir, "observations");
  const changedFiles = [];
  const warnings = [];

  if (!(await pathExists(absoluteContextDir))) {
    return {
      ok: false,
      changedFiles,
      warnings: [`Project context directory not found: ${contextDir}`],
      checkpointId: null
    };
  }

  await ensureDir(observationsDir);

  const stateText = await readText(statePath);
  const planText = (await pathExists(planPath)) ? await readText(planPath) : "";
  const state = parseState(stateText);
  const checkpointId = await nextCheckpointId(observationsDir, state.lastCheckpoint);
  const activeStepTitle = state.activeStepId ? parsePlanStepTitle(planText, state.activeStepId) : null;
  const observationText = renderObservation(checkpointId, summary);
  const observationPath = path.join(observationsDir, `${checkpointId}.md`);

  await writeText(observationPath, observationText);
  changedFiles.push(`${contextDir}/observations/${checkpointId}.md`);

  await updateContext(root, {
    target: "state",
    operation: "merge",
    payload: {
      last_checkpoint: checkpointId,
      ...(Array.isArray(summary.nextActions) && summary.nextActions.length > 0 ? { next_actions: summary.nextActions } : {})
    }
  }, { contextDir });
  changedFiles.push(`${contextDir}/STATE.yaml`);

  await writeText(handoffPath, renderHandoff({ checkpointId, state, activeStepTitle, summary, contextDir }));
  changedFiles.push(`${contextDir}/HANDOFF.md`);

  if (Array.isArray(summary.memoryEntries)) {
    for (const entry of summary.memoryEntries) {
      await updateContext(root, { target: "memory", operation: "append", payload: renderMemoryEntry(entry) }, { contextDir });
    }
    if (summary.memoryEntries.length > 0) changedFiles.push(`${contextDir}/MEMORY_INDEX.md`);
  }

  if (Array.isArray(summary.decisions)) {
    for (const decision of summary.decisions) {
      await updateContext(root, { target: "decision", operation: "append", payload: renderDecision(decision) }, { contextDir });
    }
    if (summary.decisions.length > 0) changedFiles.push(`${contextDir}/DECISIONS.md`);
  }

  return {
    ok: true,
    checkpointId,
    changedFiles: [...new Set(changedFiles)],
    warnings,
    summary
  };
}

async function nextCheckpointId(observationsDir, lastCheckpoint) {
  const ids = [];
  if (lastCheckpoint) ids.push(lastCheckpoint);
  if (await pathExists(observationsDir)) {
    for (const entry of await fs.readdir(observationsDir, { withFileTypes: true })) {
      const match = entry.isFile() ? entry.name.match(/^CP-(\d{4})\.md$/) : null;
      if (match) ids.push(`CP-${match[1]}`);
    }
  }
  const max = ids.reduce((value, id) => Math.max(value, Number(id.replace("CP-", "")) || 0), 0);
  return `CP-${String(max + 1).padStart(4, "0")}`;
}

function renderObservation(checkpointId, summary) {
  return `# ${checkpointId} ${summary.title ?? "Session Finalize"}\n\n## Summary\n\n${summary.summary ?? "No summary provided."}\n\n## Changed Files\n\n${renderList(summary.changedFiles)}\n\n## Verification\n\n${renderList(summary.verification)}\n\n## Follow-ups\n\n${renderList(summary.nextActions)}\n`;
}

function renderHandoff({ checkpointId, state, activeStepTitle, summary, contextDir }) {
  const activeStep = `${state.activeCycle ?? "unknown"}/${state.activeStepId ?? "unknown"}${activeStepTitle ? ` — ${activeStepTitle}` : ""}`;
  return `# Session Handoff\n\n## Current Snapshot\n\n- Active step: ${activeStep}.\n- Run status: ${state.runStatus ?? "unknown"}.\n- Last checkpoint: ${checkpointId}.\n- Blockers: ${Array.isArray(summary.blockers) && summary.blockers.length > 0 ? summary.blockers.join("; ") : "none known"}.\n\n## What Changed This Session\n\n${summary.summary ?? "No summary provided."}\n\n## Open Blockers\n\n${renderList(summary.blockers, "None known.")}\n\n## Next Session Start Checklist\n\n1. Read this handoff.\n2. Check ${contextDir}/STATE.yaml and ${contextDir}/PLAN.yaml.\n3. Use ${contextDir}/IMPLEMENTATION.md before broad code exploration.\n\n## Exact Next Actions\n\n${renderList(summary.nextActions, "No explicit next action recorded.", true)}\n\n## References\n\n- ${contextDir}/PLAN.yaml\n- ${contextDir}/STATE.yaml\n- ${contextDir}/IMPLEMENTATION.md\n- ${contextDir}/MEMORY_INDEX.md\n`;
}

function renderList(items, empty = "None.", numbered = false) {
  if (!Array.isArray(items) || items.length === 0) return numbered ? `1. ${empty}` : `- ${empty}`;
  return items.map((item, index) => {
    const text = typeof item === "string" ? item : (item.action ?? item.summary ?? JSON.stringify(item));
    return numbered ? `${index + 1}. ${text}` : `- ${text}`;
  }).join("\n");
}

function renderMemoryEntry(entry) {
  return `- ID: ${entry.id ?? "M-TBD"}\n  Type: ${entry.type ?? "discovery"}\n  Summary: ${entry.summary ?? "TBD"}\n  Affects: ${entry.affects ?? "TBD"}\n  References: ${entry.references ?? ".crewbee/observations"}`;
}

function renderDecision(decision) {
  return `## ${decision.id ?? "D-TBD"}\n\n- Status: ${decision.status ?? "proposed"}\n- Context: ${decision.context ?? "TBD"}\n- Decision: ${decision.decision ?? "TBD"}\n- Consequences:\n  - ${decision.consequences ?? "TBD"}`;
}
