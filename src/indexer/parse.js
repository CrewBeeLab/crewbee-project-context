export function readScalar(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "m"));
  if (!match) return null;
  return stripQuotes(match[1]);
}

export function stripQuotes(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseState(text) {
  return {
    projectId: readScalar(text, "project_id"),
    runStatus: readScalar(text, "run_status"),
    activeCycle: readScalar(text, "active_cycle"),
    activeStepId: readScalar(text, "active_step_id"),
    lastCheckpoint: readScalar(text, "last_checkpoint"),
    blockers: parseListSection(text, "blockers"),
    nextActions: parseActionItems(text)
  };
}

export function parsePlan(text) {
  return {
    projectId: readScalar(text, "project_id"),
    cycleIds: parsePlanCycleIds(text),
    stepIds: parsePlanStepIds(text)
  };
}

export function parsePlanCycleIds(text) {
  return [...text.matchAll(/^\s{2}- id:\s*([^\s]+)\s*$/gm)].map((match) => match[1]);
}

export function parsePlanStepIds(text) {
  return [...text.matchAll(/^\s{6}- id:\s*([^\s]+)\s*$/gm)].map((match) => match[1]);
}

export function parsePlanStepTitle(text, stepId) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === `- id: ${stepId}`) {
      for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
        const match = lines[cursor].match(/^\s+title:\s*(.+)$/);
        if (match) return stripQuotes(match[1]);
      }
    }
  }
  return null;
}

export function parseListSection(text, key) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith(`${key}:`)) {
      inSection = true;
      if (line.includes("[]")) return [];
      continue;
    }
    if (inSection && /^\S/.test(line)) break;
    if (inSection) {
      const match = line.match(/^\s+-\s+(.+)$/);
      if (match) result.push(stripQuotes(match[1]));
    }
  }
  return result;
}

export function parseActionItems(text) {
  const actions = [];
  for (const match of text.matchAll(/^\s+- action:\s*(.+)$/gm)) {
    actions.push(stripQuotes(match[1]));
  }
  return actions;
}

export function parseMarkdownSectionItems(markdown, heading) {
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

export function parseMemoryEntries(text, limit = 5) {
  const blocks = text.split(/\n(?=- ID:)/g);
  return blocks
    .map((block) => ({
      id: readBlockValue(block, "ID"),
      type: readBlockValue(block, "Type"),
      summary: readBlockValue(block, "Summary")
    }))
    .filter((entry) => entry.id || entry.summary)
    .slice(0, limit);
}

function readBlockValue(block, key) {
  const match = block.match(new RegExp(`${key}:\\s*(.+)`));
  return match ? stripQuotes(match[1].replace(/`/g, "").trim()) : null;
}
