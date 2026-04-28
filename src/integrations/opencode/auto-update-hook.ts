import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CONTEXT_DIR, PRIVATE_RUNTIME_CONTEXT_DIR } from "../../core/constants.js";
import { ProjectContextService } from "../../service/project-context-service.js";
import { hasSessionMethod, sessionGet, sessionMessages } from "./client-adapter.js";
import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import { writeRuntimeLog } from "./runtime-log.js";
import { MaintainerSubsessionRunner } from "./subsession-runner.js";
import type { OpenCodeClientLike } from "./types.js";
import { redactPrivateContextPaths } from "./visibility.js";

const execFileAsync = promisify(execFile);
const UPDATE_JOB_RETENTION_MS = 30 * 60 * 1000;

interface SessionUpdateState {
  inFlight: boolean;
  drainInFlight: boolean;
  pendingAfterFlight: boolean;
  lastMessageSignature?: string | undefined;
  seenMessageFingerprints: Set<string>;
  materialReasons: Set<string>;
  toolEvents: RecordedToolEvent[];
  lastPopulationSignature?: string | undefined;
}

interface PendingToolCall {
  tool: string;
  args?: unknown;
}

interface RecordedToolEvent {
  tool: string;
  reason: string;
  argsSummary: string;
  resultSummary?: string;
  timestamp: string;
}

interface UpdateJobPayload {
  schemaVersion: 1;
  kind: "project_context_update";
  jobID: string;
  createdAt: string;
  trigger: {
    reasons: string[];
    toolEvents: RecordedToolEvent[];
  };
  parentSession: {
    id: string;
    latestUserRequest: string;
    assistantFinalText: string;
    decisionsDetected: string[];
    nextActionsDetected: string[];
    blockersDetected: string[];
  };
  engineeringChanges: {
    changedFiles: string[];
    gitStatusSummary: string;
    gitDiffSummary: string;
    verification: RecordedToolEvent[];
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

function readSessionDirectory(session: unknown): string | undefined {
  if (typeof session !== "object" || session === null || Array.isArray(session)) return undefined;
  const record = session as Record<string, unknown>;
  if (typeof record.directory === "string") return record.directory;
  const data = record.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) return readSessionDirectory(data);
  return undefined;
}

function sameDirectory(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
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
  for (const key of ["text", "content", "output", "prompt", "description"]) {
    if (typeof record[key] === "string") output.push(record[key]);
  }
  for (const key of ["parts", "message", "data", "properties", "info"]) collectText(record[key], output);
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

function truncateText(text: string, maxLength = 4000): string {
  const redacted = redactPrivateContextPaths(text.trim());
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength)}\n[truncated]`;
}

function summarizeUnknown(value: unknown, maxLength = 1200): string {
  try {
    if (typeof value === "string") return truncateText(value, maxLength);
    return truncateText(JSON.stringify(value ?? {}, null, 2), maxLength);
  } catch (error) {
    return truncateText(error instanceof Error ? `unserializable: ${error.message}` : "unserializable value", maxLength);
  }
}

function runtimeText(text: string): boolean {
  return /Project Context (prepared|update) ·/i.test(text)
    || /Project Context (Maintainer|Update)/i.test(text)
    || /Project Context workspace is private/i.test(text)
    || /Unable to update private Project Context scaffold/i.test(text)
    || /Project Context Maintainer job: update/i.test(text)
    || /project-context-maintainer|project_context_update|project_context_prepare|pcu_[a-z0-9_]+/i.test(text);
}

function userText(role: string | undefined, text: string): boolean {
  return role === "user" && text.trim().length > 0 && !runtimeText(text);
}

function textMaterialReasons(role: string | undefined, text: string): string[] {
  if (text.length === 0) return [];
  if (runtimeText(text)) return [];
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

function messageFingerprint(message: unknown): string {
  if (typeof message === "object" && message !== null && !Array.isArray(message)) {
    const record = message as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : undefined;
    const info = record.info;
    if (id !== undefined) return `id:${id}`;
    if (typeof info === "object" && info !== null && !Array.isArray(info)) {
      const infoRecord = info as Record<string, unknown>;
      if (typeof infoRecord.id === "string") return `id:${infoRecord.id}`;
      if (typeof infoRecord.messageID === "string") return `messageID:${infoRecord.messageID}`;
    }
    if (typeof record.messageID === "string") return `messageID:${record.messageID}`;
  }
  return `content:${readRole(message) ?? "unknown"}:${readEventText(message)}`;
}

function updateJobID(): string {
  return `pcu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function updateJobPath(projectRoot: string, jobID: string): string {
  return path.join(projectRoot, PRIVATE_RUNTIME_CONTEXT_DIR, "cache", "update-jobs", `${jobID}.json`);
}

function extractJobID(text: string): string | undefined {
  const match = text.match(/Job ID:\s*(pcu_[a-z0-9_]+)/i);
  return match?.[1];
}

function readTaskTarget(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  const target = record.subagent_type ?? record.agent ?? record.subagent;
  return typeof target === "string" ? target : undefined;
}

function readTaskPrompt(args: unknown): string {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return "";
  const prompt = (args as Record<string, unknown>).prompt;
  return typeof prompt === "string" ? prompt : "";
}

function matchingLines(text: string, pattern: RegExp, limit = 8): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => pattern.test(line)).slice(0, limit).map((line) => truncateText(line, 500));
}

async function gitOutput(projectRoot: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, { cwd: projectRoot, timeout: 5000, windowsHide: true, maxBuffer: 128 * 1024 });
    return truncateText([result.stdout, result.stderr].filter(Boolean).join("\n") || "(empty)", 6000);
  } catch (error) {
    return truncateText(error instanceof Error ? `unavailable: git ${args.join(" ")} failed: ${error.message}` : `unavailable: git ${args.join(" ")} failed`, 1000);
  }
}

function uniqueNonEmpty(lines: string[]): string[] {
  return [...new Set(lines.map((line) => line.trim()).filter(Boolean))];
}

export class AutoUpdateManager {
  private readonly states = new Map<string, SessionUpdateState>();
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();
  private readonly maintainerSessions = new Set<string>();
  private readonly activeUpdateJobs = new Map<string, Set<string>>();
  private readonly updateTerminalSessions = new Set<string>();
  private readonly updateJobPayloadPaths = new Map<string, string>();
  private readonly maintainerUpdateJobs = new Map<string, { parentSessionID: string; jobID: string; payloadPath: string }>();

  public constructor(private readonly input: { client: OpenCodeClientLike; service: ProjectContextService; projectRoot: string }) {}

  public ignoreSession(sessionID: string): void {
    this.maintainerSessions.add(sessionID);
  }

  public isMaintainerSession(sessionID: string): boolean {
    return this.maintainerSessions.has(sessionID);
  }

  public isActiveUpdateJob(sessionID: string, jobID: string): boolean {
    return this.activeUpdateJobs.get(sessionID)?.has(jobID) === true;
  }

  public markRuntimeUpdateMaintainerSession(input: { sessionID: string; parentSessionID: string; jobID: string }): void {
    this.maintainerSessions.add(input.sessionID);
    this.maintainerUpdateJobs.set(input.sessionID, {
      parentSessionID: input.parentSessionID,
      jobID: input.jobID,
      payloadPath: this.updateJobPayloadPaths.get(input.jobID) ?? updateJobPath(this.input.projectRoot, input.jobID)
    });
  }

  public recordToolBefore(input: { tool: string; sessionID: string; callID: string }, output: { args?: unknown }): void {
    if (this.maintainerSessions.has(input.sessionID)) return;
    if (this.updateTerminalSessions.has(input.sessionID)) return;
    this.pendingToolCalls.set(toolCallKey(input.sessionID, input.callID), { tool: input.tool, args: output.args });
  }

  public recordToolAfter(input: { tool: string; sessionID: string; callID: string; args?: unknown }, output?: { result?: unknown; [key: string]: unknown }): void {
    if (this.maintainerSessions.has(input.sessionID)) return;
    if (this.updateTerminalSessions.has(input.sessionID)) return;
    const key = toolCallKey(input.sessionID, input.callID);
    const pending = this.pendingToolCalls.get(key);
    this.pendingToolCalls.delete(key);
    const args = pending?.args ?? input.args;
    const toolName = pending?.tool ?? input.tool;
    const reason = materialReason(toolName, args);
    if (!reason) return;
    const state = this.state(input.sessionID);
    state.materialReasons.add(reason);
    state.toolEvents.push({
      tool: toolName,
      reason,
      argsSummary: summarizeUnknown(args),
      ...(output && "result" in output ? { resultSummary: summarizeUnknown(output.result) } : {}),
      timestamp: new Date().toISOString()
    });
  }

  public isRuntimeUpdateTask(sessionID: string, args: unknown): boolean {
    if (readTaskTarget(args) !== PROJECT_CONTEXT_MAINTAINER_AGENT_ID) return false;
    const jobID = extractJobID(readTaskPrompt(args));
    return jobID !== undefined && this.activeUpdateJobs.get(sessionID)?.has(jobID) === true;
  }

  public recordChatMessage(input: { sessionID?: string }, output: { message?: unknown; parts?: unknown[] }): void {
    const sessionID = input.sessionID;
    if (!sessionID || this.maintainerSessions.has(sessionID)) return;
    const text = readEventText(output);
    const role = readRole(output) ?? readRole(output.message) ?? "user";
    if (this.updateTerminalSessions.has(sessionID)) {
      if (userText(role, text)) this.updateTerminalSessions.delete(sessionID);
      else return;
    }
    const state = this.state(sessionID);
    const fingerprint = messageFingerprint(output);
    if (state.seenMessageFingerprints.has(fingerprint)) return;
    state.seenMessageFingerprints.add(fingerprint);
    for (const reason of textMaterialReasons(role, text)) state.materialReasons.add(reason);
  }

  public async handleEvent(input: { event: unknown }): Promise<void> {
    const type = readEventType(input.event);
    const sessionID = readSessionID(input.event);
    if (sessionID && this.maintainerSessions.has(sessionID)) {
      if (type === "session.idle" || (type === "session.status" && readStatusType(input.event) === "idle")) {
        await this.cleanupMaintainerUpdateJob(sessionID, "maintainer_idle");
      }
      return;
    }
    if (sessionID && this.updateTerminalSessions.has(sessionID)) {
      if (type?.startsWith("message.") && userText(readRole(input.event), readEventText(input.event))) {
        this.updateTerminalSessions.delete(sessionID);
      } else {
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skip-terminal-update-session", sessionID, details: { type: type ?? "unknown" } });
        return;
      }
    }
    if (sessionID && await this.shouldIgnoreSession(sessionID)) return;
    if (type?.startsWith("message.")) {
      if (!sessionID) return;
      const state = this.state(sessionID);
      const fingerprint = messageFingerprint(input.event);
      if (state.seenMessageFingerprints.has(fingerprint)) return;
      state.seenMessageFingerprints.add(fingerprint);
      for (const reason of textMaterialReasons(readRole(input.event), readEventText(input.event))) {
        state.materialReasons.add(reason);
      }
      return;
    }
    if (type !== "session.idle" && !(type === "session.status" && readStatusType(input.event) === "idle")) return;
    if (!sessionID) return;
    await this.captureLatestSessionMessages(sessionID);
    await this.drainSession(sessionID);
  }

  private async shouldIgnoreSession(sessionID: string): Promise<boolean> {
    if (!hasSessionMethod(this.input.client, "get")) return false;
    try {
      const session = await sessionGet(this.input.client, { sessionID, query: { directory: this.input.projectRoot, workspace: this.input.projectRoot } });
      if (readParentID(session) !== undefined) return true;
      const directory = readSessionDirectory(session);
      if (directory !== undefined && !sameDirectory(directory, this.input.projectRoot)) {
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skip-foreign-session", sessionID, details: { directory } });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async captureLatestSessionMessages(sessionID: string): Promise<void> {
    try {
      const messages = await sessionMessages(this.input.client, { sessionID, query: { directory: this.input.projectRoot, workspace: this.input.projectRoot, limit: 8 } });
      const state = this.state(sessionID);
      const recent = asArray(messages).slice(-8);
      const signature = recent.map((message) => `${readRole(message) ?? "unknown"}:${readEventText(message)}`).join("\n---\n");
      if (signature === state.lastMessageSignature) return;
      state.lastMessageSignature = signature;
      for (const message of recent) {
        const fingerprint = messageFingerprint(message);
        if (state.seenMessageFingerprints.has(fingerprint)) continue;
        state.seenMessageFingerprints.add(fingerprint);
        const role = readRole(message);
        if (role !== "assistant" && role !== "user") continue;
        for (const reason of textMaterialReasons(role, readEventText(message))) state.materialReasons.add(reason);
      }
    } catch (error) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "message-scan-failed", sessionID, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async drainSession(sessionID: string): Promise<void> {
    const state = this.state(sessionID);
    if (state.drainInFlight) {
      state.pendingAfterFlight = true;
      return;
    }
    state.drainInFlight = true;
    try {
      if (state.inFlight) {
        state.pendingAfterFlight = true;
        return;
      }
      if (state.materialReasons.size === 0 && await this.markPopulationNeededIfTemplate(state)) {
        state.materialReasons.add("context_needs_population");
      }
      if (state.materialReasons.size === 0) {
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skipped", sessionID, details: { reason: "no_material_change" } });
        return;
      }
      state.inFlight = true;
      const reasons = [...state.materialReasons];
      const toolEvents = [...state.toolEvents];
      state.materialReasons.clear();
      state.toolEvents = [];
      void this.runUpdate(sessionID, reasons, toolEvents).finally(() => {
        state.inFlight = false;
        this.updateTerminalSessions.add(sessionID);
        state.pendingAfterFlight = false;
        state.materialReasons.clear();
        state.toolEvents = [];
      });
    } finally {
      state.drainInFlight = false;
      if (!state.inFlight && state.pendingAfterFlight) {
        state.pendingAfterFlight = false;
        void this.drainSession(sessionID);
      }
    }
  }

  private state(sessionID: string): SessionUpdateState {
    const existing = this.states.get(sessionID);
    if (existing) return existing;
    const created: SessionUpdateState = { inFlight: false, drainInFlight: false, pendingAfterFlight: false, seenMessageFingerprints: new Set<string>(), materialReasons: new Set<string>(), toolEvents: [] };
    this.states.set(sessionID, created);
    return created;
  }

  private async markPopulationNeededIfTemplate(state: SessionUpdateState): Promise<boolean> {
    const signature = await this.templatePopulationSignature();
    if (!signature) return false;
    if (state.lastPopulationSignature === signature) return false;
    state.lastPopulationSignature = signature;
    return true;
  }

  private async templatePopulationSignature(): Promise<string | undefined> {
    const checks = [
      { file: "PROJECT.md", pattern: /Describe the project objective\.|New Project|new-project/i },
      { file: "ARCHITECTURE.md", pattern: /^TBD\s*$/im },
      { file: "IMPLEMENTATION.md", pattern: /^TBD\s*$/im },
      { file: "HANDOFF.md", pattern: /Fill in project context files\./i }
    ];
    const matches: string[] = [];
    for (const check of checks) {
      try {
        const text = await readFile(path.join(this.input.projectRoot, DEFAULT_CONTEXT_DIR, check.file), "utf8");
        if (check.pattern.test(text)) matches.push(`${check.file}:${text.length}`);
      } catch (error) {
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "template-detect-read-failed", error: error instanceof Error ? error.message : String(error), details: { file: check.file } });
      }
    }
    return matches.length > 0 ? matches.join("|") : undefined;
  }

  private async buildUpdateJobPayload(sessionID: string, reasons: string[], toolEvents: RecordedToolEvent[]): Promise<UpdateJobPayload> {
    const messages = await this.readRecentMessages(sessionID);
    this.markMessagesConsumedForUpdate(sessionID, messages);
    const userMessages = messages.filter((message) => readRole(message) === "user" && !runtimeText(readEventText(message)));
    const assistantMessages = messages.filter((message) => readRole(message) === "assistant" && !runtimeText(readEventText(message)));
    const assistantFinalText = truncateText(readEventText(assistantMessages.at(-1)), 6000);
    const status = await gitOutput(this.input.projectRoot, ["status", "--short"]);
    const diffStat = await gitOutput(this.input.projectRoot, ["diff", "--stat"]);
    const stagedDiffStat = await gitOutput(this.input.projectRoot, ["diff", "--cached", "--stat"]);
    const changedFiles = uniqueNonEmpty([
      ...(await gitOutput(this.input.projectRoot, ["diff", "--name-only"])).split(/\r?\n/),
      ...(await gitOutput(this.input.projectRoot, ["diff", "--cached", "--name-only"])).split(/\r?\n/),
      ...status.split(/\r?\n/).map((line) => line.slice(3).trim())
    ]).filter((line) => !line.startsWith("unavailable:"));
    return {
      schemaVersion: 1,
      kind: "project_context_update",
      jobID: updateJobID(),
      createdAt: new Date().toISOString(),
      trigger: { reasons, toolEvents },
      parentSession: {
        id: sessionID,
        latestUserRequest: truncateText(readEventText(userMessages.at(-1)), 4000),
        assistantFinalText,
        decisionsDetected: matchingLines(assistantFinalText, /(决定|采用|废弃|改为|最终方案|decision|decided|adopt|deprecate)/i),
        nextActionsDetected: matchingLines(assistantFinalText, /(计划|下一步|后续|todo|next step|plan|follow-up)/i),
        blockersDetected: matchingLines(assistantFinalText, /(阻塞|失败|无法继续|待确认|blocker|blocked|failed|cannot proceed)/i)
      },
      engineeringChanges: {
        changedFiles,
        gitStatusSummary: status,
        gitDiffSummary: [`git diff --stat:\n${diffStat}`, `git diff --cached --stat:\n${stagedDiffStat}`, "If this summary is insufficient, inspect git diff directly before updating the private scaffold."].join("\n\n"),
        verification: toolEvents.filter((event) => event.reason === "verification")
      },
      instruction: [
        "Inspect current repo state if needed.",
        "Update only the private Project Context scaffold.",
        "Record material decisions, implementation state, verification evidence, blockers, and exact next actions.",
        "Run Project Context doctor/consistency checks when available.",
        "Do not modify product code and do not expose private scaffold paths in user-facing output."
      ]
    };
  }

  private async readRecentMessages(sessionID: string): Promise<unknown[]> {
    try {
      const messages = await sessionMessages(this.input.client, { sessionID, query: { directory: this.input.projectRoot, workspace: this.input.projectRoot, limit: 12 } });
      return asArray(messages).slice(-12);
    } catch (error) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "payload-message-scan-failed", sessionID, error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  private markMessagesConsumedForUpdate(sessionID: string, messages: unknown[]): void {
    const state = this.state(sessionID);
    const recent = messages.slice(-12);
    state.lastMessageSignature = recent.map((message) => `${readRole(message) ?? "unknown"}:${readEventText(message)}`).join("\n---\n");
    for (const message of recent) {
      const role = readRole(message);
      if (role !== "assistant" && role !== "user") continue;
      state.seenMessageFingerprints.add(messageFingerprint(message));
    }
  }

  private registerUpdateJob(input: { sessionID: string; jobID: string; payloadPath: string }): void {
    const jobs = this.activeUpdateJobs.get(input.sessionID) ?? new Set<string>();
    jobs.add(input.jobID);
    this.activeUpdateJobs.set(input.sessionID, jobs);
    this.updateJobPayloadPaths.set(input.jobID, input.payloadPath);
    const timer: ReturnType<typeof setTimeout> & { unref?: () => void } = setTimeout(() => {
      void rm(input.payloadPath, { force: true }).catch((error: unknown) => writeRuntimeLog(this.input.projectRoot, {
        component: "auto-update",
        event: "payload-cleanup-failed",
        sessionID: input.sessionID,
        details: { jobID: input.jobID },
        error: error instanceof Error ? error.message : String(error)
      })).finally(() => {
        const current = this.activeUpdateJobs.get(input.sessionID);
        if (!current) return;
        current.delete(input.jobID);
        if (current.size === 0) this.activeUpdateJobs.delete(input.sessionID);
        this.updateJobPayloadPaths.delete(input.jobID);
      });
    }, UPDATE_JOB_RETENTION_MS);
    timer.unref?.();
  }

  private async cleanupMaintainerUpdateJob(sessionID: string, reason: string): Promise<void> {
    const job = this.maintainerUpdateJobs.get(sessionID);
    if (!job) return;
    this.maintainerUpdateJobs.delete(sessionID);
    try {
      await rm(job.payloadPath, { force: true });
      const current = this.activeUpdateJobs.get(job.parentSessionID);
      current?.delete(job.jobID);
      if (current?.size === 0) this.activeUpdateJobs.delete(job.parentSessionID);
      this.updateJobPayloadPaths.delete(job.jobID);
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "payload-cleaned", sessionID, details: { parentSessionID: job.parentSessionID, jobID: job.jobID, reason } });
    } catch (error) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "payload-cleanup-failed", sessionID, details: { parentSessionID: job.parentSessionID, jobID: job.jobID, reason }, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async cleanupParentUpdateJob(input: { parentSessionID: string; jobID: string; payloadPath: string; reason: string }): Promise<void> {
    try {
      await rm(input.payloadPath, { force: true });
    } catch (error) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "payload-cleanup-failed", sessionID: input.parentSessionID, details: { jobID: input.jobID, reason: input.reason }, error: error instanceof Error ? error.message : String(error) });
    } finally {
      const current = this.activeUpdateJobs.get(input.parentSessionID);
      current?.delete(input.jobID);
      if (current?.size === 0) this.activeUpdateJobs.delete(input.parentSessionID);
      this.updateJobPayloadPaths.delete(input.jobID);
    }
  }

  private async runUpdate(sessionID: string, reasons: string[], toolEvents: RecordedToolEvent[]): Promise<void> {
    await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "start", sessionID, details: { reasons: reasons.join(",") } });
    let registeredJob: { jobID: string; payloadPath: string } | undefined;
    try {
      if (!hasSessionMethod(this.input.client, "prompt")) {
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "failed", sessionID, error: "OpenCode client does not expose session.prompt for parent-session update subtask card." });
        return;
      }
      const payload = await this.buildUpdateJobPayload(sessionID, reasons, toolEvents);
      const payloadPath = updateJobPath(this.input.projectRoot, payload.jobID);
      await mkdir(path.dirname(payloadPath), { recursive: true });
      await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      this.registerUpdateJob({ sessionID, jobID: payload.jobID, payloadPath });
      registeredJob = { jobID: payload.jobID, payloadPath };
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "payload-written", sessionID, details: { jobID: payload.jobID } });
      const runner = new MaintainerSubsessionRunner(this.input.client);
      const result = await runner.run({
        kind: "update",
        title: "Project Context Update",
        callerSessionID: sessionID,
        callerAgent: PROJECT_CONTEXT_MAINTAINER_AGENT_ID,
        projectRoot: this.input.projectRoot,
        goal: [
          `Load Project Context update job ${payload.jobID} from the private runtime update-job cache.`,
          "Use the job payload to update only the private Project Context scaffold.",
          "Do not continue or write to the parent session after the update is complete."
        ].join(" "),
        payload: { jobID: payload.jobID, payloadPath }
      }, {
        onSessionCreated: (createdSessionID) => {
          this.markRuntimeUpdateMaintainerSession({ sessionID: createdSessionID, parentSessionID: sessionID, jobID: payload.jobID });
        }
      });
      if (result.sessionID) await this.cleanupMaintainerUpdateJob(result.sessionID, result.ok ? "maintainer_completed" : "maintainer_failed");
      else if (!result.ok) await this.cleanupParentUpdateJob({ parentSessionID: sessionID, jobID: payload.jobID, payloadPath, reason: "maintainer_failed_without_session" });
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: result.ok ? "maintainer-completed" : "maintainer-failed", sessionID, details: { jobID: payload.jobID, reasons: reasons.join(","), maintainerSessionID: result.sessionID }, ...(result.ok ? {} : { error: result.error ?? result.output }) });
    } catch (error) {
      if (registeredJob !== undefined) await this.cleanupParentUpdateJob({ parentSessionID: sessionID, jobID: registeredJob.jobID, payloadPath: registeredJob.payloadPath, reason: "run_update_failed" });
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "failed", sessionID, details: { reasons: reasons.join(",") }, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
