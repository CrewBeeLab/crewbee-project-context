import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "../core/constants.js";
import { ProjectContextError } from "../core/errors.js";
import { getContextDir } from "../core/path.js";
import { pathExists } from "../store/file-system-store.js";
import { readWithHash, writeIfHashMatches } from "../store/optimistic-write.js";

const TARGET_FILES = {
  state: "STATE.yaml",
  handoff: "HANDOFF.md",
  memory: "MEMORY_INDEX.md",
  decision: "DECISIONS.md"
};

export async function updateContext(root = process.cwd(), patch, options = {}) {
  if (!patch || typeof patch !== "object") {
    throw new ProjectContextError("updateContext requires a patch object.");
  }
  const contextDir = options.contextDir ?? DEFAULT_CONTEXT_DIR;
  const fileName = TARGET_FILES[patch.target];
  if (!fileName) {
    throw new ProjectContextError(`Unsupported update target: ${patch.target}`);
  }

  const filePath = path.join(getContextDir(root, contextDir), fileName);
  if (!(await pathExists(filePath))) {
    throw new ProjectContextError(`Context file does not exist: ${contextDir}/${fileName}`);
  }

  const current = await readWithHash(filePath);
  const nextText = renderPatch(current.text, patch);
  const nextHash = await writeIfHashMatches(filePath, nextText, patch.expectedHash);

  return {
    ok: true,
    target: patch.target,
    file: `${contextDir}/${fileName}`,
    previousHash: current.hash,
    nextHash,
    changed: current.text !== nextText
  };
}

function renderPatch(currentText, patch) {
  const operation = patch.operation ?? "merge";
  if (operation === "replace") {
    return payloadToText(patch.payload);
  }
  if (operation === "append") {
    return `${currentText.trimEnd()}\n\n${payloadToText(patch.payload).trim()}\n`;
  }
  if (operation === "merge") {
    if (patch.target !== "state") {
      throw new ProjectContextError("merge operation is currently supported only for state updates.");
    }
    return mergeStateYaml(currentText, patch.payload);
  }
  throw new ProjectContextError(`Unsupported update operation: ${operation}`);
}

function payloadToText(payload) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload.text === "string") return payload.text;
  return JSON.stringify(payload, null, 2);
}

function mergeStateYaml(currentText, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProjectContextError("state merge payload must be an object.");
  }
  let text = currentText;
  const scalarEntries = Object.entries(payload).filter(([, value]) => !Array.isArray(value) && value === null ? false : !Array.isArray(value));
  for (const [key, value] of scalarEntries) {
    text = setTopLevelScalar(text, toSnakeCase(key), String(value));
  }
  if (Array.isArray(payload.next_actions) || Array.isArray(payload.nextActions)) {
    text = setNextActions(text, payload.next_actions ?? payload.nextActions);
  }
  return text;
}

function setTopLevelScalar(text, key, value) {
  const line = `${key}: ${value}`;
  const pattern = new RegExp(`^${escapeRegex(key)}:\\s*.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text.trimEnd()}\n${line}\n`;
}

function setNextActions(text, actions) {
  const rendered = [
    "next_actions:",
    ...actions.map((item) => {
      const action = typeof item === "string" ? item : item.action;
      const owner = typeof item === "string" ? "active-agent" : (item.owner ?? "active-agent");
      const source = typeof item === "string" ? "updateContext" : (item.source ?? "updateContext");
      return `  - action: ${action}\n    owner: ${owner}\n    source: ${source}`;
    })
  ].join("\n");
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("next_actions:"));
  if (start === -1) return `${text.trimEnd()}\n${rendered}\n`;
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith(" ") || lines[end].trim() === "")) end += 1;
  return [...lines.slice(0, start), rendered, ...lines.slice(end)].join("\n");
}

function toSnakeCase(value) {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
