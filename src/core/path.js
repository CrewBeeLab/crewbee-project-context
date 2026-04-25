import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "./constants.js";
import { UnsafeContextPathError } from "./errors.js";

export function resolveRoot(root = process.cwd()) {
  return path.resolve(root);
}

export function getContextDir(root = process.cwd(), contextDir = DEFAULT_CONTEXT_DIR) {
  return path.join(resolveRoot(root), contextDir);
}

export function resolveContextFile(root, requestedPath, contextDir = DEFAULT_CONTEXT_DIR) {
  const normalizedRequest = requestedPath.replaceAll("\\", "/");
  const withoutPrefix = normalizedRequest.startsWith(`${contextDir}/`)
    ? normalizedRequest.slice(contextDir.length + 1)
    : normalizedRequest;
  const contextRoot = getContextDir(root, contextDir);
  const resolved = path.resolve(contextRoot, withoutPrefix);
  assertInside(resolved, contextRoot);
  return resolved;
}

export function assertInside(candidatePath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UnsafeContextPathError(candidatePath);
  }
}

export function toContextRelative(root, absolutePath, contextDir = DEFAULT_CONTEXT_DIR) {
  const relative = path.relative(resolveRoot(root), absolutePath).replaceAll("\\", "/");
  return relative.startsWith(contextDir) ? relative : `${contextDir}/${relative}`;
}
