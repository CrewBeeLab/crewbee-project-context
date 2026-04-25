import path from "node:path";
import { DEFAULT_CONTEXT_DIR, REQUIRED_CONTEXT_FILES } from "../core/constants.js";
import { getContextDir } from "../core/path.js";
import { pathExists, readText } from "../store/file-system-store.js";
import { parseMarkdownSectionItems, parsePlan, parseState, readScalar } from "../indexer/parse.js";

export async function validateContext(root = process.cwd(), options = {}) {
  const contextDir = options.contextDir ?? DEFAULT_CONTEXT_DIR;
  const absoluteContextDir = getContextDir(root, contextDir);
  const errors = [];
  const warnings = [];
  const checked = [];

  if (!(await pathExists(absoluteContextDir))) {
    errors.push(`Missing context directory: ${contextDir}`);
    return { ok: false, errors, warnings, checked };
  }

  for (const fileName of REQUIRED_CONTEXT_FILES) {
    const target = path.join(absoluteContextDir, fileName);
    checked.push(`${contextDir}/${fileName}`);
    if (!(await pathExists(target))) {
      errors.push(`Missing required context file: ${contextDir}/${fileName}`);
    }
  }

  if (errors.length === 0) {
    const stateText = await readText(path.join(absoluteContextDir, "STATE.yaml"));
    const planText = await readText(path.join(absoluteContextDir, "PLAN.yaml"));
    const handoffText = await readText(path.join(absoluteContextDir, "HANDOFF.md"));
    const implementationText = await readText(path.join(absoluteContextDir, "IMPLEMENTATION.md"));
    const configText = await readText(path.join(absoluteContextDir, "config.yaml"));
    const state = parseState(stateText);
    const plan = parsePlan(planText);

    requireScalar(errors, "STATE.yaml", state, "projectId", "project_id");
    requireScalar(errors, "STATE.yaml", state, "runStatus", "run_status");
    requireScalar(errors, "STATE.yaml", state, "activeCycle", "active_cycle");
    requireScalar(errors, "STATE.yaml", state, "activeStepId", "active_step_id");
    requireScalar(errors, "PLAN.yaml", plan, "projectId", "project_id");

    if (plan.cycleIds.length === 0) {
      errors.push("PLAN.yaml must contain at least one cycle id");
    }

    if (plan.stepIds.length === 0) {
      errors.push("PLAN.yaml must contain at least one step id");
    }

    if (hasDuplicates(plan.stepIds)) {
      errors.push("PLAN.yaml contains duplicate step ids");
    }

    if (state.projectId && plan.projectId && state.projectId !== plan.projectId) {
      errors.push(`STATE.yaml project_id '${state.projectId}' does not match PLAN.yaml project_id '${plan.projectId}'`);
    }

    if (state.activeCycle && !plan.cycleIds.includes(state.activeCycle)) {
      errors.push(`STATE.yaml active_cycle '${state.activeCycle}' is not present in PLAN.yaml`);
    }

    if (!state.activeStepId) {
      errors.push("STATE.yaml is missing active_step_id");
    } else if (!plan.stepIds.includes(state.activeStepId)) {
      errors.push(`STATE.yaml active_step_id '${state.activeStepId}' is not present in PLAN.yaml`);
    }

    if (state.nextActions.length === 0) {
      warnings.push("STATE.yaml has no next_actions entries");
    }

    if (!sectionExists(handoffText, "Current Snapshot")) {
      errors.push("HANDOFF.md must contain a '## Current Snapshot' section");
    }

    if (parseMarkdownSectionItems(handoffText, "Exact Next Actions").length === 0) {
      errors.push("HANDOFF.md must contain non-empty '## Exact Next Actions' items");
    }

    if (!sectionExists(implementationText, "Verification Commands")) {
      warnings.push("IMPLEMENTATION.md should contain a '## Verification Commands' section");
    }

    const configuredContextDir = readScalar(configText, "context_dir");
    if (!configuredContextDir) {
      errors.push("config.yaml is missing context_dir");
    } else if (configuredContextDir !== contextDir) {
      errors.push(`config.yaml context_dir '${configuredContextDir}' does not match '${contextDir}'`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checked
  };
}

function requireScalar(errors, fileName, object, property, yamlKey) {
  if (!object[property]) {
    errors.push(`${fileName} is missing ${yamlKey}`);
  }
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function sectionExists(markdown, heading) {
  return markdown.split(/\r?\n/).some((line) => line.trim() === `## ${heading}`);
}
