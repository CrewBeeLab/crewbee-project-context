import path from "node:path";
import { DEFAULT_CONTEXT_DIR, DEFAULT_READ_ORDER } from "../core/constants.js";
import { getContextDir } from "../core/path.js";
import { pathExists, readText } from "../store/file-system-store.js";
import { parseMemoryEntries, parsePlanStepTitle, parseState } from "../indexer/parse.js";

export async function buildPrimer(root = process.cwd(), options = {}) {
  const contextDir = options.contextDir ?? DEFAULT_CONTEXT_DIR;
  const budgetTokens = Number(options.budgetTokens ?? 1000);
  const memoryLimit = Number(options.memoryLimit ?? 5);
  const absoluteContextDir = getContextDir(root, contextDir);
  const sourceFiles = [];
  const warnings = [];

  async function maybeRead(fileName) {
    const target = path.join(absoluteContextDir, fileName);
    if (!(await pathExists(target))) {
      warnings.push(`Missing ${contextDir}/${fileName}`);
      return "";
    }
    sourceFiles.push(`${contextDir}/${fileName}`);
    return readText(target);
  }

  const [projectText, stateText, planText, handoffText, memoryText] = await Promise.all([
    maybeRead("PROJECT.md"),
    maybeRead("STATE.yaml"),
    maybeRead("PLAN.yaml"),
    maybeRead("HANDOFF.md"),
    maybeRead("MEMORY_INDEX.md")
  ]);

  const state = parseState(stateText);
  const activeStepTitle = state.activeStepId ? parsePlanStepTitle(planText, state.activeStepId) : null;
  const memories = parseMemoryEntries(memoryText, memoryLimit);
  const projectName = extractProjectName(projectText) ?? state.projectId ?? "unknown project";
  const exactNextActions = extractSectionList(handoffText, "Exact Next Actions");
  const nextActions = exactNextActions.length > 0 ? exactNextActions : state.nextActions;

  const lines = [
    `Project Context detected: ${contextDir}/`,
    "",
    "Current:",
    `- Project: ${projectName}`,
    `- Project ID: ${state.projectId ?? "unknown"}`,
    `- Active step: ${state.activeStepId ?? "unknown"}${activeStepTitle ? ` — ${activeStepTitle}` : ""}`,
    `- Status: ${state.runStatus ?? "unknown"}`,
    `- Last checkpoint: ${state.lastCheckpoint ?? "unknown"}`,
    `- Blockers: ${state.blockers.length > 0 ? state.blockers.join("; ") : "none"}`,
    "",
    "Read order:",
    ...DEFAULT_READ_ORDER.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Next actions:",
    ...(nextActions.length > 0 ? nextActions.map((item, index) => `${index + 1}. ${item}`) : ["1. No explicit next action recorded."]),
    "",
    "High-signal memory:",
    ...(memories.length > 0
      ? memories.map((entry) => `- ${entry.id ?? "memory"} ${entry.type ?? ""}: ${entry.summary ?? ""}`.trim())
      : ["- none recorded"]),
    "",
    "Agent rule: Use project_context_read/search or targeted .crewbee reads before broad code exploration. Update .crewbee state only when project state materially changes."
  ];

  const fullText = lines.join("\n");
  const text = enforceBudget(fullText, budgetTokens);
  return {
    text,
    estimatedTokens: estimateTokens(text),
    sourceFiles,
    warnings
  };
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function enforceBudget(text, budgetTokens) {
  if (estimateTokens(text) <= budgetTokens) return text;
  const maxChars = Math.max(200, budgetTokens * 4 - 80);
  return `${text.slice(0, maxChars).trimEnd()}\n\n[Primer truncated to fit budget]`;
}

function extractProjectName(projectText) {
  const match = projectText.match(/## Project Name\s+([^#]+)/m);
  return match ? match[1].trim().split(/\r?\n/)[0].trim() : null;
}

function extractSectionList(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const result = [];
  let inSection = false;
  for (const line of lines) {
    if (line.trim() === `## ${heading}`) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) break;
    if (inSection) {
      const match = line.match(/^\s*(?:\d+\.|-)\s+(.+)$/);
      if (match) result.push(match[1].trim());
    }
  }
  return result;
}
