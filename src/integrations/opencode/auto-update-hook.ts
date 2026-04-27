import { ProjectContextService } from "../../service/project-context-service.js";
import { PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import { writeRuntimeLog } from "./runtime-log.js";
import { MaintainerSubsessionRunner } from "./subsession-runner.js";
import type { OpenCodeClientLike } from "./types.js";

interface SessionUpdateState {
  inFlight: boolean;
  pendingAfterFlight: boolean;
  lastMessageSignature?: string;
  materialReasons: Set<string>;
  toolEvents: string[];
}

interface PendingToolCall {
  tool: string;
  args?: unknown;
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

  public recordToolAfter(input: { tool: string; sessionID: string; callID: string; args?: unknown }): void {
    if (this.maintainerSessions.has(input.sessionID)) return;
    const key = toolCallKey(input.sessionID, input.callID);
    const pending = this.pendingToolCalls.get(key);
    this.pendingToolCalls.delete(key);
    const args = pending?.args ?? input.args;
    const toolName = pending?.tool ?? input.tool;
    const reason = materialReason(toolName, args);
    if (!reason) return;
    const state = this.state(input.sessionID);
    state.materialReasons.add(reason);
    state.toolEvents.push(`${toolName}:${reason}`);
  }

  public recordChatMessage(input: { sessionID?: string }, output: { message?: unknown; parts?: unknown[] }): void {
    const sessionID = input.sessionID;
    if (!sessionID || this.maintainerSessions.has(sessionID)) return;
    const text = readEventText(output);
    const role = readRole(output) ?? readRole(output.message) ?? "user";
    const state = this.state(sessionID);
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
        for (const reason of textMaterialReasons(role, readEventText(message))) state.materialReasons.add(reason);
      }
    } catch (error) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "message-scan-failed", sessionID, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async drainSession(sessionID: string): Promise<void> {
    const state = this.state(sessionID);
    if (state.inFlight) {
      state.pendingAfterFlight = true;
      return;
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
      if (state.pendingAfterFlight || state.materialReasons.size > 0) {
        state.pendingAfterFlight = false;
        void this.drainSession(sessionID);
      }
    });
  }

  private state(sessionID: string): SessionUpdateState {
    const existing = this.states.get(sessionID);
    if (existing) return existing;
    const created = { inFlight: false, pendingAfterFlight: false, materialReasons: new Set<string>(), toolEvents: [] };
    this.states.set(sessionID, created);
    return created;
  }

  private async runUpdate(sessionID: string, reasons: string[], toolEvents: string[]): Promise<void> {
    await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "start", sessionID, details: { reasons: reasons.join(",") } });
    if (!this.input.client.session.promptAsync) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "failed", sessionID, error: "OpenCode client does not expose session.promptAsync for maintainer update." });
      return;
    }
    let maintainerSessionID: string | undefined;
    const runner = new MaintainerSubsessionRunner(this.input.client);
    const result = await runner.run({
      kind: "update",
      title: `Project Context Update (@${PROJECT_CONTEXT_MAINTAINER_AGENT_ID} subagent)`,
      callerSessionID: sessionID,
      callerAgent: "project-context-runtime",
      projectRoot: this.input.projectRoot,
      goal: "Automatically maintain Project Context after a main agent turn.",
      payload: { reasons, toolEvents }
    }, {
      timeoutMs: 90_000,
      onSessionCreated: (createdSessionID) => {
        maintainerSessionID = createdSessionID;
        this.ignoreSession(createdSessionID);
      }
    });
    await this.appendVisibleUpdateStatus(sessionID, result.ok ? "completed" : "failed", maintainerSessionID ?? result.sessionID, result.ok ? undefined : result.error);
    await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: result.ok ? "completed" : "failed", sessionID, ...(maintainerSessionID ? { details: { maintainerSessionID, reasons: reasons.join(",") } } : { details: { reasons: reasons.join(",") } }), error: result.ok ? undefined : result.error });
  }

  private async appendVisibleUpdateStatus(parentSessionID: string, status: "completed" | "failed", maintainerSessionID: string | undefined, error: string | undefined): Promise<void> {
    if (!this.input.client.session.prompt) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "visible-status-unavailable", sessionID: parentSessionID, error: "OpenCode client does not expose session.prompt noReply for visible update status." });
      return;
    }
    const text = [
      status === "completed"
        ? `Project Context update · completed${maintainerSessionID ? ` · maintainer session ${maintainerSessionID} ↗` : ""}`
        : `Project Context update · failed · using previous context${maintainerSessionID ? ` · details ${maintainerSessionID} ↗` : ""}`,
      error ? `- Error: ${error}` : undefined
    ].filter((line): line is string => typeof line === "string").join("\n");
    await this.input.client.session.prompt({
      path: { id: parentSessionID },
      body: {
        noReply: true,
        parts: [{ type: "text", text, synthetic: true, metadata: { kind: "project_context_update_status", status, maintainerSessionID } }]
      },
      query: { directory: this.input.projectRoot, workspace: this.input.projectRoot }
    });
  }
}
