import { DEFAULT_CONTEXT_DIR } from "../../core/constants.js";
import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";

export const PRIVATE_CONTEXT_REDACTION = "[project-context-private]";

const PRIVATE_CONTEXT_PATTERN = new RegExp(`${escapeRegExp(DEFAULT_CONTEXT_DIR).replaceAll("/", "[\\\\\\\\/]")}(?:[\\\\/][^\\s\"'\`<>)]*)?`, "g");

export function isProjectContextMaintainer(agent?: string): boolean {
  return agent === PROJECT_CONTEXT_MAINTAINER_AGENT_ID;
}

export function containsPrivateContextPath(value: unknown): boolean {
  if (typeof value === "string") return normalizePathText(value).includes(DEFAULT_CONTEXT_DIR);
  if (Array.isArray(value)) return value.some(containsPrivateContextPath);
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) => normalizePathText(key).includes(DEFAULT_CONTEXT_DIR) || containsPrivateContextPath(item));
  }
  return false;
}

export function containsPrivateContextAccess(value: unknown): boolean {
  return containsPrivateContextAccessAtKey(undefined, value);
}

function containsPrivateContextAccessAtKey(key: string | undefined, value: unknown): boolean {
  if (typeof value === "string") return isPathLikeKey(key) && normalizePathText(value).includes(DEFAULT_CONTEXT_DIR);
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

function normalizePathText(value: string): string {
  return value.replaceAll("\\", "/");
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
