import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "../core/constants.js";
import { ProjectContextError } from "../core/errors.js";
import { assertInside, resolveRoot } from "../core/path.js";
import { pathExists, readText, writeText } from "../store/file-system-store.js";

const DEFAULT_SOURCE_DIR = ".agent";
const TEXT_FILE_EXTENSIONS = new Set([".md", ".yaml", ".yml", ".json", ".txt"]);

export async function migrateProjectContext(root = process.cwd(), options = {}) {
  const absoluteRoot = resolveRoot(root);
  const sourceDirName = options.from ?? DEFAULT_SOURCE_DIR;
  const targetDirName = options.to ?? DEFAULT_CONTEXT_DIR;
  const sourceDir = resolveProjectChild(absoluteRoot, sourceDirName);
  const targetDir = resolveProjectChild(absoluteRoot, targetDirName);

  if (sourceDirName === targetDirName) {
    throw new ProjectContextError("Migration source and target directories must differ.", {
      sourceDir: sourceDirName,
      targetDir: targetDirName
    });
  }

  if (!(await pathExists(sourceDir))) {
    throw new ProjectContextError(`Migration source directory does not exist: ${sourceDirName}`, {
      sourceDir: sourceDirName
    });
  }

  const targetExists = await pathExists(targetDir);
  if (targetExists && !options.force) {
    throw new ProjectContextError(`Migration target already exists: ${targetDirName}. Use --force to replace it.`, {
      targetDir: targetDirName
    });
  }

  if (targetExists && options.force) {
    await fs.rm(targetDir, { recursive: true, force: true });
  }

  await fs.cp(sourceDir, targetDir, { recursive: true });
  const rewrittenFiles = await rewriteDirectoryReferences(targetDir, sourceDirName, targetDirName);

  if (options.removeSource) {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }

  return {
    root: absoluteRoot,
    sourceDir: sourceDirName,
    targetDir: targetDirName,
    copied: true,
    removedSource: Boolean(options.removeSource),
    rewrittenFiles: rewrittenFiles.map((file) => path.relative(absoluteRoot, file).replaceAll("\\", "/"))
  };
}

function resolveProjectChild(root, childPath) {
  const resolved = path.resolve(root, childPath);
  assertInside(resolved, root);
  return resolved;
}

async function rewriteDirectoryReferences(dir, fromName, toName) {
  const rewritten = [];
  for await (const file of walkFiles(dir)) {
    if (!isTextFile(file)) continue;
    const text = await readText(file);
    const nextText = text.split(fromName).join(toName);
    if (nextText !== text) {
      await writeText(file, nextText);
      rewritten.push(file);
    }
  }
  return rewritten;
}

async function* walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(absolute);
    } else if (entry.isFile()) {
      yield absolute;
    }
  }
}

function isTextFile(filePath) {
  return TEXT_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
