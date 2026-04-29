import { stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONTEXT_DIR, SEARCHABLE_CONTEXT_FILES } from "../../core/constants.js";
import { ProjectContextService } from "../../service/project-context-service.js";
import { hasSessionMethod, sessionGet, sessionPrompt } from "./client-adapter.js";
import type { OpenCodeClientLike } from "./types.js";
import { writeRuntimeLog } from "./runtime-log.js";
import { isProjectContextMaintainer, redactPrivateContextPaths } from "./visibility.js";

const RUNTIME_RULE = [
  "Project Context is prepared automatically when needed.",
  "Do not call project_context_search unless auto init/prepare/update still leave a concrete historical project-context gap that blocks the task."
].join("\n");

interface PreparedSessionState {
  revision: string;
  visibleRevision?: string | undefined;
  visibleSummaryPending?: string | undefined;
  visibleFlushInFlight?: boolean | undefined;
  briefText?: string | undefined;
  systemBriefPending?: boolean | undefined;
}

const preparedSessions = new Map<string, PreparedSessionState>();
const PREPARE_STATUS_TITLE = "Project Context Prepare Summary";
let partCounter = 0;

function projectName(projectRoot: string): string {
  return path.basename(projectRoot) || "Project";
}

function projectId(projectRoot: string): string {
  return projectName(projectRoot).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

async function contextRevision(projectRoot: string): Promise<string> {
  const entries = await Promise.all(SEARCHABLE_CONTEXT_FILES.map(async (file) => {
    try {
      const info = await stat(path.join(projectRoot, DEFAULT_CONTEXT_DIR, file));
      return `${file}:${info.mtimeMs}:${info.size}`;
    } catch {
      return `${file}:missing`;
    }
  }));
  return entries.join("|");
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

function readEventType(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" ? type : undefined;
}

function readSessionID(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const properties = (value as Record<string, unknown>).properties;
  if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
    const record = properties as Record<string, unknown>;
    if (typeof record.sessionID === "string") return record.sessionID;
    if (typeof record.info === "object" && record.info !== null && !Array.isArray(record.info)) {
      const nested = record.info as Record<string, unknown>;
      if (typeof nested.sessionID === "string") return nested.sessionID;
      if (typeof nested.id === "string") return nested.id;
    }
  }
  const sessionID = (value as Record<string, unknown>).sessionID;
  return typeof sessionID === "string" ? sessionID : undefined;
}

function readStatusType(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const properties = (value as Record<string, unknown>).properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return undefined;
  const status = (properties as Record<string, unknown>).status;
  if (typeof status !== "object" || status === null || Array.isArray(status)) return undefined;
  const type = (status as Record<string, unknown>).type;
  return typeof type === "string" ? type : undefined;
}

function revisionLabel(revision: string): string {
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

function visiblePrepareSummary(input: { revision: string; estimatedTokens: number; warnings: string[]; briefText: string }): string {
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

type PrepareStatusSurface = "session.prompt.noReply" | "chat.message.synthetic";

async function showPrepareSummaryMessage(input: { client: OpenCodeClientLike; sessionID: string; projectRoot: string; summary: string }): Promise<PrepareStatusSurface | undefined> {
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

function appendPrepareSummaryPart(input: { sessionID: string; messageID?: string | undefined; output: { message?: unknown; parts?: unknown[] }; summary: string }): boolean {
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

async function shouldInjectProjectContext(input: { sessionID?: string }, client: OpenCodeClientLike, projectRoot: string): Promise<boolean> {
  if (!input.sessionID) {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "skip-no-session" });
    return false;
  }
  if (!hasSessionMethod(client, "get")) {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "skip-no-session-get", sessionID: input.sessionID });
    return false;
  }
  try {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "session-get-start", sessionID: input.sessionID });
    const session = await sessionGet(client, { sessionID: input.sessionID, query: { directory: projectRoot, workspace: projectRoot } });
    const parentID = readParentID(session);
    const directory = readSessionDirectory(session);
    if (directory !== undefined && !sameDirectory(directory, projectRoot)) {
      await writeRuntimeLog(projectRoot, { component: "system-transform", event: "skip-foreign-session", sessionID: input.sessionID, details: { directory } });
      return false;
    }
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: parentID === undefined ? "root-session" : "skip-subsession", sessionID: input.sessionID, details: parentID === undefined ? undefined : { parentID } });
    return parentID === undefined;
  } catch (error) {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "session-get-failed", sessionID: input.sessionID, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

async function ensureProjectContextInitialized(input: { service: ProjectContextService; projectRoot: string; sessionID?: string }): Promise<void> {
  const detection = await input.service.detect();
  const validation = detection.found ? await input.service.validateContext() : { ok: false, errors: ["missing context workspace"], warnings: [], checked: [] };
  const missingScaffold = !detection.found || validation.errors.some((error) => error.startsWith("Missing required context file:"));
  if (!missingScaffold) return;
  const init = await input.service.initProjectContext({ projectId: projectId(input.projectRoot), projectName: projectName(input.projectRoot) });
  await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "auto-init-scaffold", sessionID: input.sessionID, details: { created: init.created.length, skipped: init.skipped.length, errors: validation.errors.length } });
}

function hasExactPrepareMetadata(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const metadata = record.metadata;
  return typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
    && (metadata as Record<string, unknown>).kind === "project_context_prepare"
    && (metadata as Record<string, unknown>).title === PREPARE_STATUS_TITLE;
}

function readRole(value: unknown): string | undefined {
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

function blocksVisiblePrepareRole(role: string | undefined): boolean {
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

function isProjectContextRuntimeMessage(message: { info?: unknown; parts?: unknown[] } | { message?: unknown; parts?: unknown[] }): boolean {
  const prepareSurfaces = [message, ...(Array.isArray(message.parts) ? message.parts : [])].filter(hasExactPrepareMetadata);
  return prepareSurfaces.some((surface) => {
    const chunks: string[] = [];
    collectText(surface, chunks);
    return /Project Context Prepare Summary · compact · revision/i.test(chunks.join("\n"));
  });
}

function isSyntheticPreparePart(part: unknown): boolean {
  if (!hasExactPrepareMetadata(part)) return false;
  const chunks: string[] = [];
  collectText(part, chunks);
  return /Project Context Prepare Summary · compact · revision/i.test(chunks.join("\n"));
}

function isMaintainerPromptPart(part: unknown): boolean {
  if (typeof part !== "object" || part === null || Array.isArray(part)) return false;
  const record = part as Record<string, unknown>;
  return record.type === "subtask" && isProjectContextMaintainer(readAgent(record)) && typeof record.prompt === "string" && /Project Context Maintainer job:/i.test(record.prompt);
}

function isMaintainerContext(hookInput: { sessionID?: string; agent?: string; model?: unknown } | undefined, output: { messages: { info?: unknown; parts?: unknown[] }[] }): boolean {
  if (isProjectContextMaintainer(hookInput?.agent)) return true;
  return output.messages.some((message) => isProjectContextMaintainer(readAgent(message.info)) && !message.parts?.some(isMaintainerPromptPart));
}

export function createProjectContextSystemTransformHook(input: { service: ProjectContextService; client: OpenCodeClientLike; projectRoot: string; onMaintainerSessionCreated?: (sessionID: string) => void }) {
  const flushVisiblePrepare = async (sessionID: string, mode: "chat-message" | "idle", output?: { message?: unknown; parts?: unknown[] }, messageID?: string): Promise<void> => {
    const state = preparedSessions.get(sessionID);
    if (!state?.visibleSummaryPending || state.visibleFlushInFlight === true) return;
    const summary = state.visibleSummaryPending;
    preparedSessions.set(sessionID, { ...state, visibleSummaryPending: undefined, visibleFlushInFlight: true });
    try {
      let surface: PrepareStatusSurface | undefined;
      try {
        surface = await showPrepareSummaryMessage({ client: input.client, sessionID, projectRoot: input.projectRoot, summary });
      } catch (error) {
        await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "visible-prepare-message-failed", sessionID, error: error instanceof Error ? error.message : String(error) });
      }
      const appendedChatPart = surface === undefined && output !== undefined ? appendPrepareSummaryPart({ sessionID, messageID, output, summary }) : false;
      if (appendedChatPart) surface = "chat.message.synthetic";
      preparedSessions.set(sessionID, { ...state, visibleRevision: state.revision, visibleSummaryPending: undefined, visibleFlushInFlight: false });
      await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: surface === undefined ? "visible-prepare-unavailable" : "visible-prepare-status", sessionID, ...(surface !== undefined ? { details: { mode, revision: revisionLabel(state.revision), surface } } : { error: "OpenCode client does not expose session.prompt and chat.message output was unavailable for assistant-side prepare status." }) });
    } catch (error) {
      preparedSessions.set(sessionID, { ...state, visibleSummaryPending: summary, visibleFlushInFlight: false });
      await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "visible-prepare-failed", sessionID, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const hook = async (hookInput: { sessionID?: string; model: unknown }, output: { system: string[] }): Promise<void> => {
    if (!(await shouldInjectProjectContext(hookInput, input.client, input.projectRoot))) return;
    await ensureProjectContextInitialized({
      service: input.service,
      projectRoot: input.projectRoot,
      ...(hookInput.sessionID ? { sessionID: hookInput.sessionID } : {})
    });
    const sessionID = hookInput.sessionID;
    const revision = await contextRevision(input.projectRoot);
    const previous = sessionID === undefined ? undefined : preparedSessions.get(sessionID);
    const shouldPrepare = sessionID !== undefined && previous?.revision !== revision;
    if (!shouldPrepare) {
      const shouldInjectPendingBrief = previous?.briefText !== undefined && previous.systemBriefPending === true;
      output.system.push(shouldInjectPendingBrief ? `${RUNTIME_RULE}\n\n${previous.briefText}` : RUNTIME_RULE);
      if (shouldInjectPendingBrief && sessionID !== undefined) preparedSessions.set(sessionID, { ...previous, systemBriefPending: false });
      await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "injected", sessionID: hookInput.sessionID, details: { hasPrimer: shouldInjectPendingBrief } });
      return;
    }
    const brief = await input.service.prepareContext({ goal: "Prepare automatic project context for the current user task.", budget: "compact" });
    if (sessionID !== undefined) {
      const summary = visiblePrepareSummary({ revision, estimatedTokens: brief.estimatedTokens, warnings: brief.warnings, briefText: brief.text });
      preparedSessions.set(sessionID, {
        ...previous,
        revision,
        briefText: brief.text,
        systemBriefPending: false,
        ...(previous?.visibleRevision === revision ? {} : { visibleSummaryPending: summary })
      });
    }
    output.system.push(`${RUNTIME_RULE}\n\n${brief.text}`);
    await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "auto-prepare", sessionID: hookInput.sessionID, details: { estimatedTokens: brief.estimatedTokens, warnings: brief.warnings.length } });
  };
  hook.visibleChatMessage = async (hookInput: { sessionID?: string; messageID?: string; agent?: string; model?: unknown }, output: { message?: unknown; parts?: unknown[] }): Promise<void> => {
    if (isProjectContextRuntimeMessage(output)) return;
    if (blocksVisiblePrepareRole(readRole(output) ?? readRole(output.message))) return;
    if (!(await shouldInjectProjectContext(hookInput, input.client, input.projectRoot))) return;
    await ensureProjectContextInitialized({
      service: input.service,
      projectRoot: input.projectRoot,
      ...(hookInput.sessionID ? { sessionID: hookInput.sessionID } : {})
    });
    const sessionID = hookInput.sessionID;
    if (!sessionID) return;
    const revision = await contextRevision(input.projectRoot);
    const previous = preparedSessions.get(sessionID);
    if (previous?.visibleRevision === revision || previous?.visibleFlushInFlight === true) return;
    if (previous?.visibleSummaryPending === undefined) {
      const brief = previous?.revision === revision && previous.briefText !== undefined
        ? { text: previous.briefText, estimatedTokens: 0, warnings: [] }
        : await input.service.prepareContext({ goal: "Prepare automatic project context for the current user task.", budget: "compact" });
      const summary = visiblePrepareSummary({ revision, estimatedTokens: brief.estimatedTokens, warnings: brief.warnings, briefText: brief.text });
      preparedSessions.set(sessionID, {
        ...previous,
        revision,
        briefText: brief.text,
        visibleSummaryPending: summary,
        systemBriefPending: previous?.revision === revision ? previous.systemBriefPending === true : true
      });
      await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "visible-prepare-pending", sessionID, details: { estimatedTokens: brief.estimatedTokens, warnings: brief.warnings.length } });
    }
    await flushVisiblePrepare(sessionID, "chat-message", output, hookInput.messageID);
  };
  hook.handleEvent = async (eventInput: { event: unknown }): Promise<void> => {
    const type = readEventType(eventInput.event);
    if (type !== "session.idle" && !(type === "session.status" && readStatusType(eventInput.event) === "idle")) return;
    const sessionID = readSessionID(eventInput.event);
    if (!sessionID) return;
    await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "skip-visible-prepare-idle", sessionID });
  };
  hook.transformMessages = (hookInput: { sessionID?: string; agent?: string; model?: unknown } | undefined, output: { messages: { info?: unknown; parts?: unknown[] }[] }): void => {
    if (isMaintainerContext(hookInput, output)) return;
    const messages = output.messages.flatMap((message) => {
      const originalRuntimeMessage = isProjectContextRuntimeMessage(message);
      if (!Array.isArray(message.parts)) return originalRuntimeMessage ? [] : [message];
      const filtered = { ...message, parts: message.parts.filter((part) => !isMaintainerPromptPart(part) && !isSyntheticPreparePart(part)) };
      if (filtered.parts.length === 0) return [];
      return [filtered];
    });
    output.messages.splice(0, output.messages.length, ...messages);
  };
  return hook;
}
