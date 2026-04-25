import { DEFAULT_CONTEXT_DIR } from "../../core/constants.js";
import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";

export const PRIVATE_CONTEXT_REDACTION = "[project-context-private]";

const PRIVATE_CONTEXT_PATTERN = new RegExp(`${escapeRegExp(DEFAULT_CONTEXT_DIR)}(?:[\\\\/][^\\s\"'\`<>)]*)?`, "g");

export function isProjectContextMaintainer(agent?: string): boolean {
  return agent === PROJECT_CONTEXT_MAINTAINER_AGENT_ID;
}

export function containsPrivateContextPath(value: unknown): boolean {
  if (typeof value === "string") return value.includes(DEFAULT_CONTEXT_DIR);
  if (Array.isArray(value)) return value.some(containsPrivateContextPath);
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) => key.includes(DEFAULT_CONTEXT_DIR) || containsPrivateContextPath(item));
  }
  return false;
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
