import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import type { OpenCodeClientLike } from "./types.js";

export type MaintainerJobKind = "prepare" | "search" | "finalize";

export interface MaintainerJob {
  kind: MaintainerJobKind;
  title: string;
  callerSessionID: string;
  callerAgent: string;
  projectRoot: string;
  goal?: string;
  taskType?: string;
  budget?: "compact" | "normal";
  payload?: Record<string, unknown>;
}

export interface MaintainerRunResult {
  ok: boolean;
  output: string;
  sessionID?: string;
  error?: string;
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === "string") return direct;
  const data = record.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const nested = (data as Record<string, unknown>)[key];
  return typeof nested === "string" ? nested : undefined;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.messages)) return record.messages;
  return [];
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
  for (const key of ["text", "content", "output"]) {
    const text = record[key];
    if (typeof text === "string") output.push(text);
  }
  for (const key of ["parts", "message", "data"]) collectText(record[key], output);
}

function extractLastAssistantText(messages: unknown): string {
  const list = [...asArray(messages)].reverse();
  for (const item of list) {
    const role = readString(item, "role");
    if (role !== undefined && role !== "assistant") continue;
    const chunks: string[] = [];
    collectText(item, chunks);
    const text = chunks.join("\n").trim();
    if (text.length > 0) return text;
  }
  return "Project Context Maintainer completed without a text result.";
}

function renderJob(job: MaintainerJob): string {
  return [
    `Project Context Maintainer job: ${job.kind}`,
    `Caller agent: ${job.callerAgent}`,
    `Project root: ${job.projectRoot}`,
    job.goal ? `Goal: ${job.goal}` : undefined,
    job.taskType ? `Task type: ${job.taskType}` : undefined,
    job.budget ? `Budget: ${job.budget}` : undefined,
    job.payload ? `Payload JSON:\n${JSON.stringify(job.payload, null, 2)}` : undefined,
    "",
    job.kind === "finalize"
      ? "Maintain the project context workspace if needed, keep changes limited to the project-context scaffold, then return a compact success or failure summary."
      : "Return only compact, task-relevant project context for the main agent. Do not expose scaffold file paths."
  ].filter((line): line is string => typeof line === "string").join("\n");
}

export class MaintainerSubsessionRunner {
  public constructor(private readonly client: OpenCodeClientLike) {}

  public async run(job: MaintainerJob): Promise<MaintainerRunResult> {
    try {
      const created = await this.client.session.create({ body: { parentID: job.callerSessionID, title: job.title } });
      const sessionID = readString(created, "id");
      if (!sessionID) return { ok: false, output: "", error: "OpenCode did not return a maintainer subsession id." };

      await this.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: PROJECT_CONTEXT_MAINTAINER_AGENT_ID,
          parts: [{ type: "text", text: renderJob(job) }]
        }
      });

      const messages = await this.client.session.messages({ path: { id: sessionID } });
      return { ok: true, output: extractLastAssistantText(messages), sessionID };
    } catch (error) {
      return { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
    }
  }
}
