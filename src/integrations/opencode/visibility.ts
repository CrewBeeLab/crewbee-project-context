import { DEFAULT_CONTEXT_DIR, LEGACY_CONTEXT_DIR, PRIVATE_RUNTIME_CONTEXT_DIR } from "../../core/constants.js";
import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";

export const PRIVATE_CONTEXT_REDACTION = "[project-context-private]";

const PRIVATE_CONTEXT_DIRS = [...new Set([DEFAULT_CONTEXT_DIR, PRIVATE_RUNTIME_CONTEXT_DIR, LEGACY_CONTEXT_DIR])] as const;
const PRIVATE_CONTEXT_PATTERN = new RegExp(`(?:${PRIVATE_CONTEXT_DIRS.map((dir) => escapeRegExp(dir).replaceAll("/", "[\\\\/]")).join("|")})(?:[\\\\/][^\\s\"'\`<>)]*)?`, "g");

export function isProjectContextMaintainer(agent?: string): boolean {
  return agent === PROJECT_CONTEXT_MAINTAINER_AGENT_ID;
}

export function containsPrivateContextPath(value: unknown): boolean {
  if (typeof value === "string") return PRIVATE_CONTEXT_DIRS.some((dir) => normalizedIncludes(value, dir));
  if (Array.isArray(value)) return value.some(containsPrivateContextPath);
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) => PRIVATE_CONTEXT_DIRS.some((dir) => normalizedIncludes(key, dir)) || containsPrivateContextPath(item));
  }
  return false;
}

export function containsPrivateContextAccess(value: unknown): boolean {
  return containsPrivateContextAccessAtKey(undefined, value);
}

function containsPrivateContextAccessAtKey(key: string | undefined, value: unknown): boolean {
  if (typeof value === "string") return isPathLikeKey(key) && PRIVATE_CONTEXT_DIRS.some((dir) => normalizedIncludes(value, dir));
  if (Array.isArray(value)) return value.some((item) => containsPrivateContextAccessAtKey(key, item));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([itemKey, item]) => containsPrivateContextAccessAtKey(itemKey, item));
  }
  return false;
}

function isPathLikeKey(key: string | undefined): boolean {
  if (!key) return false;
  return /(^|_|-)(file|path|filepath|filename|directory|workdir|cwd|command)$/i.test(key);
}

export function redactPrivateContextPaths(text: string): string {
  return text.replace(PRIVATE_CONTEXT_PATTERN, PRIVATE_CONTEXT_REDACTION);
}

export function redactPrivateContextPathsDeep(value: unknown): unknown {
  if (typeof value === "string") return redactPrivateContextPaths(value);
  if (Array.isArray(value)) return value.map(redactPrivateContextPathsDeep);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[redactPrivateContextPaths(key)] = redactPrivateContextPathsDeep(item);
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedIncludes(value: string, needle: string): boolean {
  return value.replaceAll("\\", "/").includes(needle);
}
