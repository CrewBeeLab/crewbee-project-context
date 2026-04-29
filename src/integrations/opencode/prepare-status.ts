import { hasSessionMethod, sessionPrompt } from "./client-adapter.js";
import type { OpenCodeClientLike } from "./types.js";
import { redactPrivateContextPaths } from "./visibility.js";

export const PREPARE_STATUS_TITLE = "Project Context Prepare Summary";

export type PrepareStatusSurface = "session.prompt.noReply" | "chat.message.synthetic";

let partCounter = 0;

export function revisionLabel(revision: string): string {
  let hash = 2166136261;
  for (let index = 0; index < revision.length; index += 1) {
    hash ^= revision.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}

function createPartID(): string {
  partCounter = (partCounter + 1) % 0xfff;
  const encoded = (BigInt(Date.now()) * 0x1000n + BigInt(partCounter)).toString(16).padStart(12, "0").slice(-12);
  const suffix = Math.random().toString(36).slice(2, 16).padEnd(14, "0");
  return `prt_${encoded}${suffix}`;
}

export function visiblePrepareSummary(input: { revision: string; estimatedTokens: number; warnings: string[]; briefText: string }): string {
  const lines = input.briefText.split("\n").map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => line.startsWith("-")).slice(0, 3);
  const summary = [
    `${PREPARE_STATUS_TITLE} · compact · revision ${revisionLabel(input.revision)}`,
    "",
    ...(bullets.length > 0 ? bullets : [`- Brief injected for the main Agent.`, `- Estimated budget: ${input.estimatedTokens} tokens.`, `- Warnings: ${input.warnings.length}`])
  ].join("\n");
  return redactPrivateContextPaths(summary)
    .replace(/STATE\.yaml|HANDOFF\.md|PLAN\.yaml|MEMORY_INDEX\.md|DECISIONS\.md|REFERENCES\.md|observations/gi, "[project-context-private]");
}

export async function showPrepareSummaryMessage(input: { client: OpenCodeClientLike; sessionID: string; projectRoot: string; summary: string }): Promise<PrepareStatusSurface | undefined> {
  if (!hasSessionMethod(input.client, "prompt")) return undefined;
  await sessionPrompt(input.client, {
    sessionID: input.sessionID,
    body: {
      noReply: true,
      parts: [{ type: "text", text: input.summary, ignored: true, metadata: { kind: "project_context_prepare", title: PREPARE_STATUS_TITLE } }]
    },
    query: { directory: input.projectRoot, workspace: input.projectRoot }
  });
  return "session.prompt.noReply";
}

function readMessageID(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.messageID === "string") return record.messageID;
  if (typeof record.id === "string") return record.id;
  for (const key of ["message", "info", "properties"]) {
    const nested = record[key];
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      const id = readMessageID(nested);
      if (id !== undefined) return id;
    }
  }
  return undefined;
}

export function appendPrepareSummaryPart(input: { sessionID: string; messageID?: string | undefined; output: { message?: unknown; parts?: unknown[] }; summary: string }): boolean {
  const messageID = input.messageID ?? readMessageID(input.output.message);
  if (!messageID) return false;
  if (!Array.isArray(input.output.parts)) input.output.parts = [];
  input.output.parts.push({
    id: createPartID(),
    sessionID: input.sessionID,
    messageID,
    type: "text",
    text: input.summary,
    synthetic: true,
    ignored: true,
    metadata: { kind: "project_context_prepare", title: PREPARE_STATUS_TITLE }
  });
  return true;
}
