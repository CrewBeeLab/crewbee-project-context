import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "../core/constants.js";
import { getContextDir, resolveContextFile, resolveRoot } from "../core/path.js";

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

export async function writeText(filePath, text, options = {}) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, text, { encoding: "utf8", flag: options.flag ?? "w" });
}

export async function detect(root = process.cwd(), options = {}) {
  const contextDir = options.contextDir ?? DEFAULT_CONTEXT_DIR;
  const absoluteRoot = resolveRoot(root);
  const absoluteContextDir = getContextDir(absoluteRoot, contextDir);
  const found = await pathExists(absoluteContextDir);
  return {
    found,
    root: absoluteRoot,
    contextDir: found ? absoluteContextDir : null,
    contextDirName: contextDir,
    reason: found ? "context directory exists" : "context directory not found"
  };
}

export async function readContextFile(root, requestedPath, options = {}) {
  const contextDir = options.contextDir ?? DEFAULT_CONTEXT_DIR;
  const absolutePath = resolveContextFile(root, requestedPath, contextDir);
  return {
    path: absolutePath,
    text: await readText(absolutePath)
  };
}

export async function listObservationFiles(root, options = {}) {
  const contextDir = options.contextDir ?? DEFAULT_CONTEXT_DIR;
  const observationsDir = resolveContextFile(root, "observations", contextDir);
  if (!(await pathExists(observationsDir))) {
    return [];
  }
  const entries = await fs.readdir(observationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(observationsDir, entry.name));
}
