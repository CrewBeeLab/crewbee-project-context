import { ProjectContextService } from "../../service/project-context-service.js";
import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import { writeRuntimeLog } from "./runtime-log.js";
import type { OpenCodeClientLike } from "./types.js";
import { DEFAULT_CONTEXT_DIR } from "../../core/constants.js";
import { execFile } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface SessionUpdateState {
  inFlight: boolean;
  pendingAfterFlight: boolean;
  lastMessageSignature?: string;
  materialReasons: Set<string>;
  toolEvents: string[];
  latestUserRequest: string | undefined;
  assistantFinalText: string | undefined;
  decisions: Set<string>;
  nextActions: Set<string>;
  blockers: Set<string>;
  verificationOutputs: string[];
}

interface PendingToolCall {
  tool: string;
  args?: unknown;
}

interface UpdateJobPayload {
  trigger: {
    reasons: string[];
    toolEvents: string[];
  };
  parentSessionSummary: {
    latestUserRequest: string | undefined;
    assistantFinalText: string | undefined;
    decisions: string[];
    nextActions: string[];
    blockers: string[];
  };
  engineeringChanges: {
    changedFiles: string[];
    gitStatusSummary: string;
    gitDiffSummary: string;
    verificationOutputs: string[];
  };
  instruction: string[];
}

function readEventType(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null || Array.isArray(event)) return undefined;
  const type = (event as Record<string, unknown>).type;
  return typeof type === "string" ? type : undefined;
}

function readSessionID(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null || Array.isArray(event)) return undefined;
  const properties = (event as Record<string, unknown>).properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return undefined;
  const direct = (properties as Record<string, unknown>).sessionID;
  if (typeof direct === "string") return direct;
  const info = (properties as Record<string, unknown>).info;
  if (typeof info !== "object" || info === null || Array.isArray(info)) return undefined;
  const nested = (info as Record<string, unknown>).sessionID;
  if (typeof nested === "string") return nested;
  const id = (info as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

function readStatusType(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null || Array.isArray(event)) return undefined;
  const properties = (event as Record<string, unknown>).properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return undefined;
  const status = (properties as Record<string, unknown>).status;
  if (typeof status !== "object" || status === null || Array.isArray(status)) return undefined;
  const type = (status as Record<string, unknown>).type;
  return typeof type === "string" ? type : undefined;
}

function readParentID(session: unknown): string | undefined {
  if (typeof session !== "object" || session === null || Array.isArray(session)) return undefined;
  const record = session as Record<string, unknown>;
  if (typeof record.parentID === "string") return record.parentID;
  const data = record.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) return readParentID(data);
  return undefined;
}

function readRole(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.role === "string") return record.role;
  if (typeof record.info === "object" && record.info !== null && !Array.isArray(record.info)) return readRole(record.info);
  if (typeof record.message === "object" && record.message !== null && !Array.isArray(record.message)) return readRole(record.message);
  if (typeof record.properties === "object" && record.properties !== null && !Array.isArray(record.properties)) return readRole(record.properties);
  return undefined;
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
    if (typeof record[key] === "string") output.push(record[key]);
  }
  for (const key of ["result", "parts", "message", "data", "properties", "info"]) collectText(record[key], output);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.messages)) return record.messages;
  return [];
}

function readEventText(event: unknown): string {
  const chunks: string[] = [];
  collectText(event, chunks);
  return chunks.join("\n").trim();
}

function compactText(text: string, max = 1_600): string {
  const cleaned = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}\n[truncated ${cleaned.length - max} chars]`;
}

function addSignalLines(target: Set<string>, text: string, pattern: RegExp): void {
  for (const line of text.split("\n")) {
    const cleaned = line.trim();
    if (!cleaned || !pattern.test(cleaned)) continue;
    target.add(compactText(cleaned, 240));
  }
}

function recordMessageSummary(state: SessionUpdateState, role: string | undefined, text: string): void {
  if (!text.trim()) return;
  if (role === "user") state.latestUserRequest = compactText(text, 1_200);
  if (role === "assistant") {
    state.assistantFinalText = compactText(text, 2_400);
    addSignalLines(state.decisions, text, /(决定|采用|废弃|改为|最终方案|decision|decided|adopt|deprecat)/i);
    addSignalLines(state.nextActions, text, /(计划|下一步|后续|todo|next step|plan|follow-up)/i);
    addSignalLines(state.blockers, text, /(阻塞|失败|无法继续|待确认|blocker|blocked|failed|cannot proceed)/i);
  }
}

function textMaterialReasons(role: string | undefined, text: string): string[] {
  if (text.length === 0) return [];
  if (/Project Context (prepared|update) ·/i.test(text)) return [];
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  if (role === "assistant") {
    if (/(决定|采用|废弃|改为|最终方案|decision|decided|adopt|deprecate)/i.test(text)) reasons.push("decision");
    if (/(计划|下一步|后续|todo|next step|plan|follow-up)/i.test(text)) reasons.push("plan_or_next_actions");
    if (/(阻塞|失败|无法继续|待确认|blocker|blocked|failed|cannot proceed)/i.test(text)) reasons.push("blocker");
    if (/(已实现|已修复|重构|迁移|implemented|fixed|refactored|migrated)/i.test(text)) reasons.push("implementation_state");
  }
  if (role === "user" && /(记录到上下文|更新上下文|更新项目记忆|record.*context|update.*context)/i.test(lower)) reasons.push("user_requested_context_update");
  return [...new Set(reasons)];
}

function stringifyArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return String(args ?? "");
  }
}

function materialReason(toolName: string, args: unknown): string | null {
  const text = `${toolName} ${stringifyArgs(args)}`.toLowerCase();
  if (["edit", "write", "patch", "apply_patch", "apply_patch.apply_patch"].some((name) => toolName.toLowerCase().includes(name))) return "files_changed";
  if (toolName === "project_context_search") return "context_search";
  if (toolName === "bash" && /\b(test|build|typecheck|lint|doctor)\b/.test(text)) return "verification";
  return null;
}

function toolCallKey(sessionID: string, callID: string): string {
  return `${sessionID}:${callID}`;
}

function isProjectContextUpdateTask(args: unknown): boolean {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return false;
  const record = args as Record<string, unknown>;
  return (record.subagent_type ?? record.agent ?? record.subagent) === PROJECT_CONTEXT_MAINTAINER_AGENT_ID && record.command === "project_context_update";
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const direct = (value as Record<string, unknown>)[key];
  return typeof direct === "string" ? direct : undefined;
}

function updateJobsDir(projectRoot: string): string {
  return path.join(projectRoot, DEFAULT_CONTEXT_DIR, "cache", "update-jobs");
}

function isSafeUpdateJobRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const prefix = `${DEFAULT_CONTEXT_DIR}/cache/update-jobs/`;
  if (!normalized.startsWith(prefix) || !normalized.endsWith(".json")) return false;
  const relativeWithinJobs = normalized.slice(prefix.length);
  return relativeWithinJobs.length > 0 && !relativeWithinJobs.split("/").includes("..") && !path.isAbsolute(normalized);
}

function updateJobRelativePath(jobID: string): string {
  return path.join(DEFAULT_CONTEXT_DIR, "cache", "update-jobs", `${jobID}.json`).replace(/\\/g, "/");
}

function updateJobAbsolutePath(projectRoot: string, relativePath: string): string {
  return path.join(projectRoot, relativePath);
}

function readUpdateJobPathFromPrompt(prompt: string | undefined): string | undefined {
  if (!prompt) return undefined;
  const match = prompt.match(/^Job payload file:\s*(.+)$/m);
  return match?.[1]?.trim();
}

async function gitOutput(projectRoot: string, args: string[], timeoutMs = 5_000): Promise<string> {
  return await new Promise((resolve) => {
    const child = execFile("git", ["-C", projectRoot, ...args], { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolve(compactText(`unavailable: ${message}${stderr ? `\n${stderr}` : ""}`.trim(), 1_200));
        return;
      }
      resolve(compactText(`${stdout}${stderr ? `\n${stderr}` : ""}`, 3_000) || "clean / no output");
    });
    child.on("error", (error) => resolve(`unavailable: ${error.message}`));
  });
}

async function collectEngineeringSnapshot(projectRoot: string): Promise<{ changedFiles: string[]; gitStatus: string; gitDiffSummary: string }> {
  const gitStatus = await gitOutput(projectRoot, ["status", "--short"]);
  const changedFiles = gitStatus.startsWith("unavailable:")
    ? []
    : gitStatus
      .split("\n")
      .map((line) => line.trim().replace(/^..\s+/, ""))
      .filter((line) => line.length > 0 && line !== "clean / no output")
      .slice(0, 80);
  const gitDiffSummary = await gitOutput(projectRoot, ["diff", "--stat"]);
  return { changedFiles, gitStatus, gitDiffSummary };
}

function buildUpdatePayload(input: {
  reasons: string[];
  toolEvents: string[];
  latestUserRequest: string | undefined;
  assistantFinalText: string | undefined;
  decisions: string[];
  nextActions: string[];
  blockers: string[];
  changedFiles: string[];
  gitStatus: string;
  gitDiffSummary: string;
  verificationOutputs: string[];
}): UpdateJobPayload {
  return {
    trigger: {
      reasons: input.reasons,
      toolEvents: input.toolEvents
    },
    parentSessionSummary: {
      latestUserRequest: input.latestUserRequest,
      assistantFinalText: input.assistantFinalText,
      decisions: input.decisions,
      nextActions: input.nextActions,
      blockers: input.blockers
    },
    engineeringChanges: {
      changedFiles: input.changedFiles,
      gitStatusSummary: input.gitStatus,
      gitDiffSummary: input.gitDiffSummary,
      verificationOutputs: input.verificationOutputs
    },
    instruction: [
      "Inspect current repo state if needed, especially git status and git diff.",
      "Update only the private Project Context scaffold/workspace.",
      "Record durable implementation state, project decisions, risks, blockers, and next actions.",
      "Run doctor / consistency checks when available; do not fabricate verification.",
      "Return a compact success or failure summary."
    ]
  };
}

async function writeUpdateJob(projectRoot: string, payload: UpdateJobPayload): Promise<{ jobID: string; relativePath: string }> {
  const jobID = `update-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const relativePath = updateJobRelativePath(jobID);
  await mkdir(updateJobsDir(projectRoot), { recursive: true });
  await writeFile(updateJobAbsolutePath(projectRoot, relativePath), JSON.stringify({ jobID, createdAt: new Date().toISOString(), payload }, null, 2), "utf8");
  return { jobID, relativePath };
}

async function deleteUpdateJob(projectRoot: string, relativePath: string | undefined): Promise<void> {
  if (!relativePath) return;
  const normalized = relativePath.replace(/\\/g, "/");
  if (!isSafeUpdateJobRelativePath(normalized)) return;
  const jobsDir = path.resolve(updateJobsDir(projectRoot));
  const target = path.resolve(updateJobAbsolutePath(projectRoot, normalized));
  const relative = path.relative(jobsDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return;
  await unlink(target).catch(() => undefined);
}

function renderUpdateSubtaskPrompt(input: { jobID: string; jobFile: string }): string {
  return [
    "Project Context Maintainer job: update",
    "",
    `Job ID: ${input.jobID}`,
    `Job payload file: ${input.jobFile}`,
    "",
    "Instruction:",
    "- Read the JSON payload from the job payload file before updating context.",
    "- Use that payload as the source of truth for this main-session turn.",
    "- Update only the private Project Context scaffold/workspace.",
    "- Run doctor / consistency checks when available; do not fabricate verification.",
    "- Return a compact success or failure summary. The Project Context runtime will delete the job file after this task completes."
  ].join("\n");
}

export class AutoUpdateManager {
  private readonly states = new Map<string, SessionUpdateState>();
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();
  private readonly maintainerSessions = new Set<string>();

  public constructor(private readonly input: { client: OpenCodeClientLike; service: ProjectContextService; projectRoot: string }) {}

  public ignoreSession(sessionID: string): void {
    this.maintainerSessions.add(sessionID);
  }

  public recordToolBefore(input: { tool: string; sessionID: string; callID: string }, output: { args?: unknown }): void {
    if (this.maintainerSessions.has(input.sessionID)) return;
    this.pendingToolCalls.set(toolCallKey(input.sessionID, input.callID), { tool: input.tool, args: output.args });
  }

  public async recordToolAfter(input: { tool: string; sessionID: string; callID: string; args?: unknown }, output?: { result?: unknown; [key: string]: unknown }): Promise<void> {
    if (this.maintainerSessions.has(input.sessionID)) return;
    const key = toolCallKey(input.sessionID, input.callID);
    if (input.tool === "task" && isProjectContextUpdateTask(input.args)) {
      this.pendingToolCalls.delete(key);
      await deleteUpdateJob(this.input.projectRoot, readUpdateJobPathFromPrompt(readString(input.args, "prompt")));
      return;
    }
    const pending = this.pendingToolCalls.get(key);
    this.pendingToolCalls.delete(key);
    const args = pending?.args ?? input.args;
    const toolName = pending?.tool ?? input.tool;
    const reason = materialReason(toolName, args);
    if (!reason) return;
    const state = this.state(input.sessionID);
    state.materialReasons.add(reason);
    state.toolEvents.push(`${toolName}:${reason}`);
    if (reason === "verification") state.verificationOutputs.push(`${toolName} ${compactText(stringifyArgs(args), 400)} => ${compactText(readEventText(output), 1_000)}`);
  }

  public recordChatMessage(input: { sessionID?: string }, output: { message?: unknown; parts?: unknown[] }): void {
    const sessionID = input.sessionID;
    if (!sessionID || this.maintainerSessions.has(sessionID)) return;
    const text = readEventText(output);
    const role = readRole(output) ?? readRole(output.message) ?? "user";
    const state = this.state(sessionID);
    recordMessageSummary(state, role, text);
    for (const reason of textMaterialReasons(role, text)) state.materialReasons.add(reason);
  }

  public async handleEvent(input: { event: unknown }): Promise<void> {
    const type = readEventType(input.event);
    const sessionID = readSessionID(input.event);
    if (sessionID && this.maintainerSessions.has(sessionID)) return;
    if (sessionID && await this.isSubsession(sessionID)) return;
    if (type?.startsWith("message.")) {
      if (!sessionID) return;
      const state = this.state(sessionID);
      const text = readEventText(input.event);
      const role = readRole(input.event);
      recordMessageSummary(state, role, text);
      for (const reason of textMaterialReasons(role, text)) {
        state.materialReasons.add(reason);
      }
      return;
    }
    if (type !== "session.idle" && !(type === "session.status" && readStatusType(input.event) === "idle")) return;
    if (!sessionID) return;
    await this.captureLatestSessionMessages(sessionID);
    await this.drainSession(sessionID);
  }

  private async isSubsession(sessionID: string): Promise<boolean> {
    if (!this.input.client.session.get) return false;
    try {
      const session = await this.input.client.session.get({ path: { id: sessionID }, query: { directory: this.input.projectRoot, workspace: this.input.projectRoot } });
      return readParentID(session) !== undefined;
    } catch {
      return false;
    }
  }

  private async captureLatestSessionMessages(sessionID: string): Promise<void> {
    try {
      const messages = await this.input.client.session.messages({ path: { id: sessionID }, query: { directory: this.input.projectRoot, workspace: this.input.projectRoot, limit: 8 } });
      const state = this.state(sessionID);
      const recent = asArray(messages).slice(-8);
      const signature = recent.map((message) => `${readRole(message) ?? "unknown"}:${readEventText(message)}`).join("\n---\n");
      if (signature === state.lastMessageSignature) return;
      state.lastMessageSignature = signature;
      for (const message of recent) {
        const role = readRole(message);
        if (role !== "assistant" && role !== "user") continue;
        const text = readEventText(message);
        recordMessageSummary(state, role, text);
        for (const reason of textMaterialReasons(role, text)) state.materialReasons.add(reason);
      }
    } catch (error) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "message-scan-failed", sessionID, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async drainSession(sessionID: string): Promise<void> {
    const state = this.state(sessionID);
    if (state.inFlight) {
      state.pendingAfterFlight = true;
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "evaluated", sessionID, details: { result: "in_flight", mode: "evaluate_every_turn" } });
      return;
    }
    if (state.materialReasons.size === 0) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "evaluated", sessionID, details: { result: "skipped", reason: "no_material_change", mode: "evaluate_every_turn" } });
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skipped", sessionID, details: { reason: "no_material_change" } });
      return;
    }
    state.inFlight = true;
    const reasons = [...state.materialReasons];
    const toolEvents = [...state.toolEvents];
    const updateInput = {
      latestUserRequest: state.latestUserRequest,
      assistantFinalText: state.assistantFinalText,
      decisions: [...state.decisions],
      nextActions: [...state.nextActions],
      blockers: [...state.blockers],
      verificationOutputs: [...state.verificationOutputs]
    };
    state.materialReasons.clear();
    state.toolEvents = [];
    state.verificationOutputs = [];
    await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "evaluated", sessionID, details: { result: "maintainer_update", reasons: reasons.join(","), mode: "evaluate_every_turn" } });
    void this.runUpdate(sessionID, reasons, toolEvents, updateInput).finally(() => {
      state.inFlight = false;
      if (state.pendingAfterFlight || state.materialReasons.size > 0) {
        state.pendingAfterFlight = false;
        void this.drainSession(sessionID);
      }
    });
  }

  private state(sessionID: string): SessionUpdateState {
    const existing = this.states.get(sessionID);
    if (existing) return existing;
    const created = { inFlight: false, pendingAfterFlight: false, materialReasons: new Set<string>(), toolEvents: [], latestUserRequest: undefined, assistantFinalText: undefined, decisions: new Set<string>(), nextActions: new Set<string>(), blockers: new Set<string>(), verificationOutputs: [] };
    this.states.set(sessionID, created);
    return created;
  }

  private async runUpdate(sessionID: string, reasons: string[], toolEvents: string[], summary: { latestUserRequest: string | undefined; assistantFinalText: string | undefined; decisions: string[]; nextActions: string[]; blockers: string[]; verificationOutputs: string[] }): Promise<void> {
    await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "start", sessionID, details: { reasons: reasons.join(",") } });
    if (!this.input.client.session.promptAsync) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "failed", sessionID, error: "OpenCode client does not expose session.promptAsync for maintainer update subtask." });
      return;
    }
    try {
      const engineering = await collectEngineeringSnapshot(this.input.projectRoot);
      const payload = buildUpdatePayload({ reasons, toolEvents, ...summary, ...engineering });
      const job = await writeUpdateJob(this.input.projectRoot, payload);
      await this.input.client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [{
            type: "subtask",
            agent: PROJECT_CONTEXT_MAINTAINER_AGENT_ID,
            command: "project_context_update",
            description: "Project Context update",
            prompt: renderUpdateSubtaskPrompt({ jobID: job.jobID, jobFile: job.relativePath })
          }]
        },
        query: { directory: this.input.projectRoot, workspace: this.input.projectRoot }
      });
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "task-card-launched", sessionID, details: { reasons: reasons.join(","), agent: PROJECT_CONTEXT_MAINTAINER_AGENT_ID, jobID: job.jobID } });
    } catch (error) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "failed", sessionID, error: error instanceof Error ? error.message : String(error), details: { reasons: reasons.join(",") } });
      if (this.input.client.session.prompt) {
        await this.appendVisibleUpdateStatus(sessionID, "failed", error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async appendVisibleUpdateStatus(parentSessionID: string, status: "failed", error: string | undefined): Promise<void> {
    if (!this.input.client.session.prompt) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "visible-status-unavailable", sessionID: parentSessionID, error: "OpenCode client does not expose session.prompt noReply for visible update status." });
      return;
    }
    const text = [
      "Project Context update · failed · using previous context",
      error ? `- Error: ${error}` : undefined
    ].filter((line): line is string => typeof line === "string").join("\n");
    await this.input.client.session.prompt({
      path: { id: parentSessionID },
      body: {
        noReply: true,
        parts: [{ type: "text", text, ignored: true, metadata: { kind: "project_context_update_status", status } }]
      },
      query: { directory: this.input.projectRoot, workspace: this.input.projectRoot }
    });
  }
}
