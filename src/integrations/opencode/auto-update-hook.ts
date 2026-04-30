import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectContextService } from "../../service/project-context-service.js";
import { hasSessionMethod, sessionGet, sessionMessages } from "./client-adapter.js";
import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import { writeRuntimeLog } from "./runtime-log.js";
import { MaintainerSubsessionRunner } from "./subsession-runner.js";
import type { OpenCodeClientLike } from "./types.js";
import { readProjectContextEnabled } from "./project-config.js";
import { readEventType, readSessionDirectory, readSessionParentID, readStatusType, sameDirectory } from "./shape-readers.js";
import { isAssistantText, isRuntimeText, isUserText, materialReason, stringifyArgs, textMaterialReasons } from "./auto-update-rules.js";
import { collectGitUpdateSummary, createUpdateJobID, matchingLines, type RecordedToolEvent, summarizeUnknownForUpdate, truncateUpdateText, type UpdateJobPayload, updateJobPath } from "./auto-update-payload.js";

const UPDATE_JOB_RETENTION_MS = 30 * 60 * 1000;

interface SessionUpdateState {
  currentTurnID: number;
  inFlight: boolean;
  drainInFlight: boolean;
  pendingAfterFlight: boolean;
  lastRealUserMessageID?: string | undefined;
  lastRealUserMessageAt?: number | undefined;
  lastAssistantMessageID?: string | undefined;
  lastAssistantMessageAt?: number | undefined;
  assistantSeenAfterLatestUser: boolean;
  updateEligibleTurnID?: number | undefined;
  materialTurnID?: number | undefined;
  lastUpdatedTurnID?: number | undefined;
  lastMessageSignature?: string | undefined;
  seenMessageFingerprints: Set<string>;
  materialReasons: Set<string>;
  toolEvents: RecordedToolEvent[];
}

interface PendingToolCall {
  tool: string;
  args?: unknown;
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
  for (const key of ["parts", "message", "data", "properties", "info", "state", "metadata"]) collectText(record[key], output);
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

function toolCallKey(sessionID: string, callID: string): string {
  return `${sessionID}:${callID}`;
}

function messageFingerprint(message: unknown): string {
  if (typeof message === "object" && message !== null && !Array.isArray(message)) {
    const record = message as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : undefined;
    const info = record.info;
    if (id !== undefined) return `id:${id}`;
    const nestedMessage = record.message;
    if (typeof nestedMessage === "object" && nestedMessage !== null && !Array.isArray(nestedMessage)) {
      const messageRecord = nestedMessage as Record<string, unknown>;
      if (typeof messageRecord.id === "string") return `id:${messageRecord.id}`;
      if (typeof messageRecord.messageID === "string") return `messageID:${messageRecord.messageID}`;
    }
    if (typeof info === "object" && info !== null && !Array.isArray(info)) {
      const infoRecord = info as Record<string, unknown>;
      if (typeof infoRecord.id === "string") return `id:${infoRecord.id}`;
      if (typeof infoRecord.messageID === "string") return `messageID:${infoRecord.messageID}`;
    }
    if (typeof record.messageID === "string") return `messageID:${record.messageID}`;
  }
  return `content:${readRole(message) ?? "unknown"}:${readEventText(message)}`;
}

function extractJobID(text: string): string | undefined {
  const match = text.match(/Job ID:\s*(pcu_[a-z0-9_]+)/i);
  return match?.[1];
}

function extractRuntimeJobID(value: unknown): string | undefined {
  const text = `${readEventText(value)}\n${stringifyArgs(value)}`;
  const match = text.match(/pcu_[a-z0-9_]+/i);
  return match?.[0];
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

export class AutoUpdateManager {
  private readonly states = new Map<string, SessionUpdateState>();
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();
  private readonly maintainerSessions = new Set<string>();
  private readonly activeUpdateJobs = new Map<string, Set<string>>();
  private readonly updateTaskResultJobs = new Map<string, Set<string>>();
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

  public async recordToolAfter(input: { tool: string; sessionID: string; callID: string; args?: unknown }, output?: { result?: unknown; [key: string]: unknown }): Promise<void> {
    if (this.maintainerSessions.has(input.sessionID)) {
      if (input.tool === "read" && extractRuntimeJobID(input.args) !== undefined) await this.cleanupMaintainerUpdatePayload(input.sessionID, "payload_read_completed");
      return;
    }
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
      argsSummary: summarizeUnknownForUpdate(args),
      ...(output && "result" in output ? { resultSummary: summarizeUnknownForUpdate(output.result) } : {}),
      timestamp: new Date().toISOString()
    });
    state.materialTurnID = state.currentTurnID;
  }

  public isRuntimeUpdateTask(sessionID: string, args: unknown): boolean {
    if (readTaskTarget(args) !== PROJECT_CONTEXT_MAINTAINER_AGENT_ID) return false;
    const jobID = extractJobID(readTaskPrompt(args));
    return jobID !== undefined && (this.activeUpdateJobs.get(sessionID)?.has(jobID) === true || this.updateTaskResultJobs.get(sessionID)?.has(jobID) === true);
  }

  public filterRuntimeUpdateTaskResult(input: { tool: string; sessionID: string; args?: unknown }, output: { result?: unknown; [key: string]: unknown }): void {
    if (input.tool !== "task") return;
    if (!this.isRuntimeUpdateTask(input.sessionID, input.args)) return;
    const jobID = extractJobID(readTaskPrompt(input.args));
    if (!jobID) return;
    const existingResult = summarizeUnknownForUpdate(output.result, 2000);
    const status = /PROJECT_CONTEXT_UPDATE_DONE\s+job=pcu_[a-z0-9_]+\s+status=failed|\b(error|exception|blocked)\b|(?:update|task)\s+failed/i.test(existingResult) ? "failed" : "ok";
    output.result = [
      `PROJECT_CONTEXT_UPDATE_DONE job=${jobID} status=${status}`,
      "",
      "This is an internal runtime maintenance result.",
      "Do not continue the parent conversation because of this result."
    ].join("\n");
  }

  private voidStalePendingForNewUserTurn(state: SessionUpdateState): void {
    state.materialReasons.clear();
    state.toolEvents = [];
    state.materialTurnID = undefined;
    state.updateEligibleTurnID = undefined;
    state.pendingAfterFlight = false;
  }

  public async recordChatMessage(input: { sessionID?: string }, output: { message?: unknown; parts?: unknown[] }): Promise<void> {
    const sessionID = input.sessionID;
    if (!sessionID || this.maintainerSessions.has(sessionID)) return;
    const text = readEventText(output);
    const role = readRole(output) ?? readRole(output.message);
    if (role === undefined) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skip-message-unknown-role", sessionID });
      return;
    }
    if (this.updateTerminalSessions.has(sessionID)) {
      if (isUserText(role, text)) this.clearUpdateTerminalSession(sessionID);
      else return;
    }
    const state = this.state(sessionID);
    const fingerprint = messageFingerprint(output);
    if (state.seenMessageFingerprints.has(fingerprint)) return;
    state.seenMessageFingerprints.add(fingerprint);
    this.recordTurnMessage(state, role, text, fingerprint, true);
    for (const reason of textMaterialReasons(role, text)) state.materialReasons.add(reason);
  }

  public async handleEvent(input: { event: unknown }): Promise<void> {
    const type = readEventType(input.event);
    const sessionID = readSessionID(input.event);
    const idleEvent = type === "session.idle" || (type === "session.status" && readStatusType(input.event) === "idle");
    if (sessionID && this.maintainerSessions.has(sessionID)) {
      if (idleEvent) {
        await this.cleanupMaintainerUpdatePayload(sessionID, "maintainer_idle");
      }
      return;
    }
    if (sessionID && this.updateTerminalSessions.has(sessionID)) {
      if (type?.startsWith("message.") && isUserText(readRole(input.event), readEventText(input.event))) {
        this.clearUpdateTerminalSession(sessionID);
      } else {
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skip-terminal-update-session", sessionID, details: { type: type ?? "unknown" } });
        return;
      }
    }
    if (sessionID && (type?.startsWith("message.") || idleEvent) && !await this.projectContextEnabled(sessionID)) return;
    if (sessionID && await this.shouldIgnoreSession(sessionID)) return;
    if (type?.startsWith("message.")) {
      if (!sessionID) return;
      const state = this.state(sessionID);
      const fingerprint = messageFingerprint(input.event);
      if (state.seenMessageFingerprints.has(fingerprint)) return;
      state.seenMessageFingerprints.add(fingerprint);
      const role = readRole(input.event);
      const text = readEventText(input.event);
      this.recordTurnMessage(state, role, text, fingerprint, true);
      for (const reason of textMaterialReasons(role, text)) {
        state.materialReasons.add(reason);
      }
      return;
    }
    if (!idleEvent) return;
    if (!sessionID) return;
    await this.captureLatestSessionMessages(sessionID);
    await this.drainSession(sessionID);
  }

  private async shouldIgnoreSession(sessionID: string): Promise<boolean> {
    if (!hasSessionMethod(this.input.client, "get")) return false;
    try {
      const session = await sessionGet(this.input.client, { sessionID, query: { directory: this.input.projectRoot, workspace: this.input.projectRoot } });
      if (readSessionParentID(session) !== undefined) return true;
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

  private async projectContextEnabled(sessionID: string): Promise<boolean> {
    const config = await readProjectContextEnabled(this.input.projectRoot);
    if (config.error !== undefined) await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "config-read-failed", sessionID, details: { configPath: config.configPath }, error: config.error });
    if (!config.enabled) await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skipped", sessionID, details: { reason: "disabled_by_project_config", configPath: config.configPath } });
    return config.enabled;
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
        const text = readEventText(message);
        this.recordTurnMessage(state, role, text, fingerprint, false);
        for (const reason of textMaterialReasons(role, text)) state.materialReasons.add(reason);
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
      if (state.materialReasons.size === 0) {
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skipped", sessionID, details: { reason: "no_material_change" } });
        return;
      }
      if (!state.assistantSeenAfterLatestUser) {
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skipped", sessionID, details: { reason: "waiting_for_assistant_final_response", currentTurnID: state.currentTurnID } });
        return;
      }
      if (state.updateEligibleTurnID !== state.currentTurnID) {
        state.materialReasons.clear();
        state.toolEvents = [];
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skipped", sessionID, details: { reason: "not_in_assistant_idle_window", updateEligibleTurnID: state.updateEligibleTurnID, currentTurnID: state.currentTurnID } });
        return;
      }
      state.updateEligibleTurnID = undefined;
      if (state.materialTurnID !== state.currentTurnID) {
        state.materialReasons.clear();
        state.toolEvents = [];
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skipped", sessionID, details: { reason: "material_change_not_in_current_turn", materialTurnID: state.materialTurnID, currentTurnID: state.currentTurnID } });
        return;
      }
      if (state.lastUpdatedTurnID === state.currentTurnID) {
        state.materialReasons.clear();
        state.toolEvents = [];
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skipped", sessionID, details: { reason: "turn_already_updated", currentTurnID: state.currentTurnID } });
        return;
      }
      const hasCurrentFileChange = state.toolEvents.some((event) => event.reason === "files_changed");
      if (!hasCurrentFileChange) {
        state.materialReasons.clear();
        state.toolEvents = [];
        await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "skipped", sessionID, details: { reason: "no_engineering_file_change" } });
        return;
      }
      state.inFlight = true;
      state.lastUpdatedTurnID = state.currentTurnID;
      this.updateTerminalSessions.add(sessionID);
      const reasons = [...state.materialReasons];
      const toolEvents = [...state.toolEvents];
      state.materialReasons.clear();
      state.toolEvents = [];
      void this.runUpdate(sessionID, reasons, toolEvents).finally(() => {
        state.inFlight = false;
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
    const created: SessionUpdateState = { currentTurnID: 0, inFlight: false, drainInFlight: false, pendingAfterFlight: false, assistantSeenAfterLatestUser: false, seenMessageFingerprints: new Set<string>(), materialReasons: new Set<string>(), toolEvents: [] };
    this.states.set(sessionID, created);
    return created;
  }

  private recordTurnMessage(state: SessionUpdateState, role: string | undefined, text: string, fingerprint: string, resetPendingOnUser: boolean): void {
    const now = Date.now();
    if (isUserText(role, text)) {
      state.currentTurnID += 1;
      state.lastRealUserMessageID = fingerprint;
      state.lastRealUserMessageAt = now;
      state.assistantSeenAfterLatestUser = false;
      if (resetPendingOnUser) this.voidStalePendingForNewUserTurn(state);
      return;
    }
    if (!isAssistantText(role, text)) return;
    state.lastAssistantMessageID = fingerprint;
    state.lastAssistantMessageAt = now;
    if (state.lastRealUserMessageAt !== undefined && now >= state.lastRealUserMessageAt) {
      state.assistantSeenAfterLatestUser = true;
      state.updateEligibleTurnID = state.currentTurnID;
    }
  }

  private clearUpdateTerminalSession(sessionID: string): void {
    this.updateTerminalSessions.delete(sessionID);
    this.updateTaskResultJobs.delete(sessionID);
  }

  private async buildUpdateJobPayload(sessionID: string, reasons: string[], toolEvents: RecordedToolEvent[]): Promise<UpdateJobPayload> {
    const messages = await this.readRecentMessages(sessionID);
    this.markMessagesConsumedForUpdate(sessionID, messages);
    const userMessages = messages.filter((message) => readRole(message) === "user" && !isRuntimeText(readEventText(message)));
    const assistantMessages = messages.filter((message) => readRole(message) === "assistant" && !isRuntimeText(readEventText(message)));
    const assistantFinalText = truncateUpdateText(readEventText(assistantMessages.at(-1)), 6000);
    const gitSummary = await collectGitUpdateSummary(this.input.projectRoot);
    return {
      schemaVersion: 1,
      kind: "project_context_update",
      jobID: createUpdateJobID(),
      createdAt: new Date().toISOString(),
      trigger: { reasons, toolEvents },
      parentSession: {
        id: sessionID,
        latestUserRequest: truncateUpdateText(readEventText(userMessages.at(-1)), 4000),
        assistantFinalText,
        decisionsDetected: matchingLines(assistantFinalText, /(决定|采用|废弃|改为|最终方案|decision|decided|adopt|deprecate)/i),
        nextActionsDetected: matchingLines(assistantFinalText, /(计划|下一步|后续|todo|next step|plan|follow-up)/i),
        blockersDetected: matchingLines(assistantFinalText, /(阻塞|失败|无法继续|待确认|blocker|blocked|failed|cannot proceed)/i)
      },
      engineeringChanges: {
        changedFiles: gitSummary.changedFiles,
        gitStatusSummary: gitSummary.status,
        gitDiffSummary: [`git diff --stat:\n${gitSummary.diffStat}`, `git diff --cached --stat:\n${gitSummary.stagedDiffStat}`, "If this summary is insufficient, inspect git diff directly before updating the private scaffold."].join("\n\n"),
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

  private trackUpdatePayload(input: { sessionID: string; jobID: string; payloadPath: string }): void {
    const jobs = this.activeUpdateJobs.get(input.sessionID) ?? new Set<string>();
    jobs.add(input.jobID);
    this.activeUpdateJobs.set(input.sessionID, jobs);
    const taskResultJobs = this.updateTaskResultJobs.get(input.sessionID) ?? new Set<string>();
    taskResultJobs.add(input.jobID);
    this.updateTaskResultJobs.set(input.sessionID, taskResultJobs);
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
        current?.delete(input.jobID);
        if (current?.size === 0) this.activeUpdateJobs.delete(input.sessionID);
        const taskResults = this.updateTaskResultJobs.get(input.sessionID);
        taskResults?.delete(input.jobID);
        if (taskResults?.size === 0) this.updateTaskResultJobs.delete(input.sessionID);
        this.updateJobPayloadPaths.delete(input.jobID);
      });
    }, UPDATE_JOB_RETENTION_MS);
    timer.unref?.();
  }

  private async cleanupMaintainerUpdatePayload(sessionID: string, reason: string): Promise<void> {
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

  private async cleanupParentUpdatePayload(input: { parentSessionID: string; jobID: string; payloadPath: string; reason: string }): Promise<void> {
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
      this.trackUpdatePayload({ sessionID, jobID: payload.jobID, payloadPath });
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
      if (result.sessionID) await this.cleanupMaintainerUpdatePayload(result.sessionID, result.ok ? "maintainer_completed" : "maintainer_failed");
      else if (!result.ok) await this.cleanupParentUpdatePayload({ parentSessionID: sessionID, jobID: payload.jobID, payloadPath, reason: "maintainer_failed_without_session" });
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: result.ok ? "maintainer-completed" : "maintainer-failed", sessionID, details: { jobID: payload.jobID, reasons: reasons.join(","), maintainerSessionID: result.sessionID }, ...(result.ok ? {} : { error: result.error ?? result.output }) });
    } catch (error) {
      if (registeredJob !== undefined) await this.cleanupParentUpdatePayload({ parentSessionID: sessionID, jobID: registeredJob.jobID, payloadPath: registeredJob.payloadPath, reason: "run_update_failed" });
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "failed", sessionID, details: { reasons: reasons.join(",") }, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
