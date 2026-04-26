import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import type { OpenCodeClientLike } from "./types.js";
import { writeRuntimeLog } from "./runtime-log.js";

export type MaintainerJobKind = "initialize" | "search" | "update";

export interface MaintainerJob {
  kind: MaintainerJobKind;
  title: string;
  callerSessionID: string;
  callerAgent: string;
  projectRoot: string;
  goal?: string;
  budget?: "compact" | "normal";
  payload?: Record<string, unknown>;
}

export interface MaintainerRunResult {
  ok: boolean;
  output: string;
  sessionID?: string;
  error?: string;
}

export interface MaintainerRunOptions {
  abort?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onSessionCreated?: (sessionID: string) => void;
  fallback?: (reason: string) => MaintainerRunResult;
}

interface MaintainerRunLogEvent {
  event: string;
  runId: string;
  jobKind: MaintainerJobKind;
  callerAgent: string;
  sessionID?: string;
  elapsedMs?: number;
  statusType?: string;
  messageCount?: number;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_JOB_TIMEOUT_MS: Record<MaintainerJobKind, number> = {
  initialize: 180_000,
  search: 45_000,
  update: 90_000
};
const DEFAULT_POLL_INTERVAL_MS = 500;
const API_CALL_TIMEOUT_MS = 15_000;
const MAINTAINER_DISABLED_TOOLS = {
  project_context_search: false
} as const;

function maintainerTimeoutMs(kind: MaintainerJobKind): number {
  const raw = process.env.CREWBEE_PROJECT_CONTEXT_MAINTAINER_TIMEOUT_MS;
  if (!raw) return DEFAULT_JOB_TIMEOUT_MS[kind] ?? DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

function readMessageRole(value: unknown): string | undefined {
  return readString(value, "role") ?? readString((value as { info?: unknown })?.info, "role");
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.messages)) return record.messages;
  return [];
}

async function writeRunLog(projectRoot: string, event: MaintainerRunLogEvent): Promise<void> {
  await writeRuntimeLog(projectRoot, {
    component: "maintainer-runner",
    event: event.event,
    runId: event.runId,
    sessionID: event.sessionID,
    agent: event.callerAgent,
    elapsedMs: event.elapsedMs,
    error: event.error,
    details: {
      jobKind: event.jobKind,
      statusType: event.statusType,
      messageCount: event.messageCount
    }
  });
}

function messageCount(messages: unknown): number {
  return asArray(messages).length;
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
    const role = readMessageRole(item);
    if (role !== undefined && role !== "assistant") continue;
    const chunks: string[] = [];
    collectText(item, chunks);
    const text = chunks.join("\n").trim();
    if (text.length > 0) return text;
  }
  return "Project Context Maintainer completed without a text result.";
}

function hasAssistantText(messages: unknown): boolean {
  const list = asArray(messages);
  for (const item of list) {
    const role = readMessageRole(item);
    if (role !== undefined && role !== "assistant") continue;
    const chunks: string[] = [];
    collectText(item, chunks);
    if (chunks.join("\n").trim().length > 0) return true;
  }
  return false;
}

function readSessionStatusType(statuses: unknown, sessionID: string): string | undefined {
  if (typeof statuses !== "object" || statuses === null || Array.isArray(statuses)) return undefined;
  const record = statuses as Record<string, unknown>;
  const direct = record[sessionID];
  if (typeof direct === "object" && direct !== null && !Array.isArray(direct)) {
    const type = (direct as Record<string, unknown>).type;
    if (typeof type === "string") return type;
  }
  const data = record.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) return readSessionStatusType(data, sessionID);
  return undefined;
}

function renderJob(job: MaintainerJob): string {
  return [
    `Project Context Maintainer job: ${job.kind}`,
    `Caller agent: ${job.callerAgent}`,
    `Project root: ${job.projectRoot}`,
    job.goal ? `Goal: ${job.goal}` : undefined,
    job.budget ? `Budget: ${job.budget}` : undefined,
      job.payload ? `Payload JSON:\n${JSON.stringify(job.payload, null, 2)}` : undefined,
      "",
    job.kind === "search"
      ? "Search the project context workspace by goal, reason across relevant context, then return compact findings. Do not expose scaffold file paths."
      : job.kind === "initialize"
        ? "Initialize the project context workspace. Read the project documentation, architecture/design notes, package metadata, tests, and main source implementation. Then update only the project-context scaffold with a compact project overview, architecture, implementation snapshot, current plan/state, decisions, risks, and handoff. Do not expose scaffold file paths."
        : "Maintain the project context workspace if needed, keep changes limited to the project-context scaffold, then return a compact success or failure summary."
  ].filter((line): line is string => typeof line === "string").join("\n");
}

export class MaintainerSubsessionRunner {
  public constructor(private readonly client: OpenCodeClientLike) {}

  public async run(job: MaintainerJob, options: MaintainerRunOptions = {}): Promise<MaintainerRunResult> {
    const id = runId();
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? maintainerTimeoutMs(job.kind);
    const deadline = Date.now() + timeoutMs;
    const query = { directory: job.projectRoot, workspace: job.projectRoot };
    let sessionID: string | undefined;
    try {
      await writeRunLog(job.projectRoot, { event: "start", runId: id, jobKind: job.kind, callerAgent: job.callerAgent, sessionID: job.callerSessionID });
      if (aborted(options.abort)) return { ok: false, output: "", error: "Maintainer subsession was aborted before start." };

      const created = await withTimeout(this.client.session.create({ body: { parentID: job.callerSessionID, title: job.title }, query }), Math.min(API_CALL_TIMEOUT_MS, timeoutMs), "OpenCode maintainer subsession create");
      sessionID = readString(created, "id");
      if (!sessionID) return { ok: false, output: "", error: "OpenCode did not return a maintainer subsession id." };
      options.onSessionCreated?.(sessionID);
      await writeRunLog(job.projectRoot, { event: "session-created", runId: id, jobKind: job.kind, callerAgent: job.callerAgent, sessionID, elapsedMs: Date.now() - startedAt });

      const promptInput = {
        path: { id: sessionID },
        body: {
          agent: PROJECT_CONTEXT_MAINTAINER_AGENT_ID,
          tools: MAINTAINER_DISABLED_TOOLS,
          parts: [{ type: "text" as const, text: renderJob(job) }]
        },
        query
      };

      if (!this.client.session.promptAsync) {
        throw new Error("OpenCode client does not expose session.promptAsync; refusing to use blocking session.prompt from a tool execution callback.");
      }

      await withTimeout(this.client.session.promptAsync(promptInput), Math.min(API_CALL_TIMEOUT_MS, Math.max(1, deadline - Date.now())), "OpenCode maintainer subsession prompt_async");
      await writeRunLog(job.projectRoot, { event: "prompt-accepted", runId: id, jobKind: job.kind, callerAgent: job.callerAgent, sessionID, elapsedMs: Date.now() - startedAt });
      const output = await this.waitForCompletedOutput(job, id, startedAt, sessionID, query, deadline, options);
      await writeRunLog(job.projectRoot, { event: "completed", runId: id, jobKind: job.kind, callerAgent: job.callerAgent, sessionID, elapsedMs: Date.now() - startedAt });
      return { ok: true, output, sessionID };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await writeRunLog(job.projectRoot, { event: "failed", runId: id, jobKind: job.kind, callerAgent: job.callerAgent, ...(sessionID ? { sessionID } : {}), elapsedMs: Date.now() - startedAt, error: reason });
      if (sessionID && this.client.session.abort) {
        try {
          await withTimeout(this.client.session.abort({ path: { id: sessionID }, query }), 2_000, "OpenCode maintainer subsession abort");
          await writeRunLog(job.projectRoot, { event: "abort-sent", runId: id, jobKind: job.kind, callerAgent: job.callerAgent, sessionID, elapsedMs: Date.now() - startedAt });
        } catch (cleanupError) {
          void cleanupError; // Best-effort cleanup only; preserve the original failure reason.
        }
      }
      return options.fallback?.(reason) ?? { ok: false, output: "", error: reason };
    }
  }

  private async waitForCompletedOutput(job: MaintainerJob, runIdValue: string, startedAt: number, sessionID: string, query: { directory: string; workspace: string }, deadline: number, options: MaintainerRunOptions): Promise<string> {
    while (Date.now() < deadline) {
      if (aborted(options.abort)) throw new Error("Maintainer subsession was aborted.");

      const messages = await withTimeout(this.client.session.messages({ path: { id: sessionID }, query: { ...query, limit: 20 } }), Math.min(API_CALL_TIMEOUT_MS, Math.max(1, deadline - Date.now())), "OpenCode maintainer subsession messages");
      const status = this.client.session.status
        ? await withTimeout(this.client.session.status({ query }), Math.min(API_CALL_TIMEOUT_MS, Math.max(1, deadline - Date.now())), "OpenCode session status")
        : undefined;
      const statusType = status === undefined ? undefined : readSessionStatusType(status, sessionID);
      await writeRunLog(job.projectRoot, { event: "poll", runId: runIdValue, jobKind: job.kind, callerAgent: job.callerAgent, sessionID, elapsedMs: Date.now() - startedAt, ...(statusType ? { statusType } : {}), messageCount: messageCount(messages) });
      if ((statusType === "idle" || statusType === undefined) && hasAssistantText(messages)) return extractLastAssistantText(messages);
      if (statusType === undefined && hasAssistantText(messages)) return extractLastAssistantText(messages);
      await sleep(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    }
    throw new Error(`Maintainer subsession did not complete within ${options.timeoutMs ?? maintainerTimeoutMs(job.kind)}ms.`);
  }
}
