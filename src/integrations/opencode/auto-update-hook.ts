import { ProjectContextService } from "../../service/project-context-service.js";
import { writeRuntimeLog } from "./runtime-log.js";
import { MaintainerSubsessionRunner } from "./subsession-runner.js";
import type { OpenCodeClientLike } from "./types.js";

interface SessionUpdateState {
  inFlight: boolean;
  materialReasons: Set<string>;
  toolEvents: string[];
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
  return typeof nested === "string" ? nested : undefined;
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

function readEventText(event: unknown): string {
  const chunks: string[] = [];
  collectText(event, chunks);
  return chunks.join("\n").trim();
}

function textMaterialReasons(role: string | undefined, text: string): string[] {
  if (text.length === 0) return [];
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

export class AutoUpdateManager {
  private readonly states = new Map<string, SessionUpdateState>();
  private readonly runner: MaintainerSubsessionRunner;

  public constructor(private readonly input: { client: OpenCodeClientLike; service: ProjectContextService; projectRoot: string }) {
    this.runner = new MaintainerSubsessionRunner(input.client);
  }

  public recordTool(input: { tool: string; sessionID: string; args?: unknown }): void {
    const reason = materialReason(input.tool, input.args);
    if (!reason) return;
    const state = this.state(input.sessionID);
    state.materialReasons.add(reason);
    state.toolEvents.push(`${input.tool}:${reason}`);
  }

  public async handleEvent(input: { event: unknown }): Promise<void> {
    const type = readEventType(input.event);
    if (type?.startsWith("message.")) {
      const sessionID = readSessionID(input.event);
      if (!sessionID) return;
      const state = this.state(sessionID);
      for (const reason of textMaterialReasons(readRole(input.event), readEventText(input.event))) {
        state.materialReasons.add(reason);
      }
      return;
    }
    if (type !== "session.idle") return;
    const sessionID = readSessionID(input.event);
    if (!sessionID) return;
    const state = this.state(sessionID);
    if (state.inFlight) return;
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
    });
  }

  private state(sessionID: string): SessionUpdateState {
    const existing = this.states.get(sessionID);
    if (existing) return existing;
    const created = { inFlight: false, materialReasons: new Set<string>(), toolEvents: [] };
    this.states.set(sessionID, created);
    return created;
  }

  private async runUpdate(sessionID: string, reasons: string[], toolEvents: string[]): Promise<void> {
    await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "start", sessionID, details: { reasons: reasons.join(",") } });
    const result = await this.runner.run({
      kind: "update",
      title: "Project Context Update",
      callerSessionID: sessionID,
      callerAgent: "project-context-runtime",
      projectRoot: this.input.projectRoot,
      goal: "Automatically maintain Project Context after a main agent turn.",
      payload: { reasons, tool_events: toolEvents }
    }, { timeoutMs: 90_000 });
    if (!result.ok) {
      await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: "failed", sessionID, error: result.error });
      return;
    }
    const validation = await this.input.service.validateContext();
    await writeRuntimeLog(this.input.projectRoot, { component: "auto-update", event: validation.ok ? "completed" : "invalid", sessionID, details: { errors: validation.errors.length, warnings: validation.warnings.length } });
  }
}
