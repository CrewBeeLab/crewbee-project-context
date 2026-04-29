import { PREPARE_STATUS_TITLE } from "./prepare-status.js";
import { isProjectContextMaintainer } from "./visibility.js";

function hasExactPrepareMetadata(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const metadata = record.metadata;
  return typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
    && (metadata as Record<string, unknown>).kind === "project_context_prepare"
    && (metadata as Record<string, unknown>).title === PREPARE_STATUS_TITLE;
}

export function readRole(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.role === "string") return record.role;
  for (const key of ["message", "info", "properties"]) {
    const nested = record[key];
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      const role = readRole(nested);
      if (role !== undefined) return role;
    }
  }
  return undefined;
}

function readAgent(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.agent === "string") return record.agent;
  if (typeof record.subagent_type === "string") return record.subagent_type;
  if (typeof record.subagent === "string") return record.subagent;
  for (const key of ["message", "info", "properties", "metadata"]) {
    const nested = record[key];
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      const agent = readAgent(nested);
      if (agent !== undefined) return agent;
    }
  }
  return undefined;
}

export function blocksVisiblePrepareRole(role: string | undefined): boolean {
  return role === "assistant" || role === "system" || role === "tool";
}

function collectText(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  for (const key of ["text", "content", "output", "prompt", "description"]) {
    if (typeof record[key] === "string") output.push(record[key]);
  }
  for (const key of ["parts", "message", "data", "properties", "info", "state", "metadata"]) collectText(record[key], output);
}

export function isProjectContextRuntimeMessage(message: { info?: unknown; parts?: unknown[] } | { message?: unknown; parts?: unknown[] }): boolean {
  const prepareSurfaces = [message, ...(Array.isArray(message.parts) ? message.parts : [])].filter(hasExactPrepareMetadata);
  return prepareSurfaces.some((surface) => {
    const chunks: string[] = [];
    collectText(surface, chunks);
    return /Project Context Prepare Summary · compact · revision/i.test(chunks.join("\n"));
  });
}

export function isSyntheticPreparePart(part: unknown): boolean {
  if (!hasExactPrepareMetadata(part)) return false;
  const chunks: string[] = [];
  collectText(part, chunks);
  return /Project Context Prepare Summary · compact · revision/i.test(chunks.join("\n"));
}

export function isMaintainerPromptPart(part: unknown): boolean {
  if (typeof part !== "object" || part === null || Array.isArray(part)) return false;
  const record = part as Record<string, unknown>;
  return record.type === "subtask" && isProjectContextMaintainer(readAgent(record)) && typeof record.prompt === "string" && /Project Context Maintainer job:/i.test(record.prompt);
}

export function isMaintainerContext(hookInput: { sessionID?: string; agent?: string; model?: unknown } | undefined, output: { messages: { info?: unknown; parts?: unknown[] }[] }): boolean {
  if (isProjectContextMaintainer(hookInput?.agent)) return true;
  return output.messages.some((message) => isProjectContextMaintainer(readAgent(message.info)) && !message.parts?.some(isMaintainerPromptPart));
}
