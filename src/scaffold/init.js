import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "../core/constants.js";
import { getContextDir, resolveRoot } from "../core/path.js";
import { ensureDir, pathExists, readText, writeText } from "../store/file-system-store.js";

const TEMPLATE_DIR = new URL("../../templates/crewbee-template/", import.meta.url);

export async function initProjectContext(root = process.cwd(), options = {}) {
  const contextDir = options.contextDir ?? DEFAULT_CONTEXT_DIR;
  const absoluteRoot = resolveRoot(root);
  const absoluteContextDir = getContextDir(absoluteRoot, contextDir);
  const templates = await readTemplates(options, contextDir);
  const created = [];
  const skipped = [];

  await ensureDir(absoluteContextDir);
  await ensureDir(path.join(absoluteContextDir, "observations"));
  await ensureDir(path.join(absoluteContextDir, "cache"));

  for (const [fileName, content] of Object.entries(templates)) {
    const target = path.join(absoluteContextDir, fileName);
    if (!options.force && (await pathExists(target))) {
      skipped.push(`${contextDir}/${fileName}`);
      continue;
    }
    await writeText(target, content.endsWith("\n") ? content : `${content}\n`);
    created.push(`${contextDir}/${fileName}`);
  }

  return {
    root: absoluteRoot,
    contextDir: absoluteContextDir,
    created,
    skipped
  };
}

async function readTemplates(options, contextDir) {
  const projectId = options.projectId ?? "new-project";
  const projectName = options.projectName ?? "New Project";
  const entries = await fs.readdir(TEMPLATE_DIR, { withFileTypes: true });
  const templates = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const text = await readText(new URL(entry.name, TEMPLATE_DIR));
    templates[entry.name] = renderTemplate(text, { projectId, projectName, contextDir });
  }
  return templates;
}

function renderTemplate(text, values) {
  return text
    .replaceAll("new-project", values.projectId)
    .replaceAll("New Project", values.projectName)
    .replaceAll(".crewbee", values.contextDir);
}
