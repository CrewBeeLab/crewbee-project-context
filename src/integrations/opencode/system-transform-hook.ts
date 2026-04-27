import { stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONTEXT_DIR, SEARCHABLE_CONTEXT_FILES } from "../../core/constants.js";
import { ProjectContextService } from "../../service/project-context-service.js";
import { MaintainerSubsessionRunner } from "./subsession-runner.js";
import type { OpenCodeClientLike } from "./types.js";
import { writeRuntimeLog } from "./runtime-log.js";

const RUNTIME_RULE = [
  "Project Context is prepared automatically when needed.",
  "Do not call project_context_search unless auto init/prepare/update still leave a concrete historical project-context gap that blocks the task."
].join("\n");

interface PreparedSessionState {
  revision: string;
  visibleRevision?: string;
  briefText?: string;
  systemBriefPending?: boolean;
}

const preparedSessions = new Map<string, PreparedSessionState>();
const initializationJobs = new Map<string, Promise<void>>();

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

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === "string") return direct;
  const info = record.info;
  if (typeof info === "object" && info !== null && !Array.isArray(info)) return readString(info, key);
  return undefined;
}

function partID(): string {
  const time = BigInt(Date.now()) * 0x1000n + BigInt(Math.floor(Math.random() * 0x1000));
  const hex = time.toString(16).padStart(12, "0").slice(-12);
  return `prt_${hex}${Math.random().toString(36).slice(2, 16).padEnd(14, "0")}`;
}

function revisionLabel(revision: string): string {
  let hash = 2166136261;
  for (let index = 0; index < revision.length; index += 1) {
    hash ^= revision.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}

function visiblePrepareSummary(input: { revision: string; estimatedTokens: number; warnings: string[]; briefText: string }): string {
  const lines = input.briefText.split("\n").map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => line.startsWith("-")).slice(0, 3);
  return [
    `Project Context prepared · compact · revision ${revisionLabel(input.revision)}`,
    "",
    ...(bullets.length > 0 ? bullets : [`- Brief injected for the main Agent.`, `- Estimated budget: ${input.estimatedTokens} tokens.`, `- Warnings: ${input.warnings.length}`])
  ].join("\n").replace(/\.crewbeectxt|STATE\.yaml|HANDOFF\.md|PLAN\.yaml|observations/gi, "[project-context-private]");
}

async function shouldInjectProjectContext(input: { sessionID?: string }, client: OpenCodeClientLike, projectRoot: string): Promise<boolean> {
  if (!input.sessionID) {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "skip-no-session" });
    return false;
  }
  if (!client.session.get) {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "skip-no-session-get", sessionID: input.sessionID });
    return false;
  }
  try {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "session-get-start", sessionID: input.sessionID });
    const session = await client.session.get({ path: { id: input.sessionID }, query: { directory: projectRoot, workspace: projectRoot } });
    const parentID = readParentID(session);
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: parentID === undefined ? "root-session" : "skip-subsession", sessionID: input.sessionID, details: parentID === undefined ? undefined : { parentID } });
    return parentID === undefined;
  } catch (error) {
    await writeRuntimeLog(projectRoot, { component: "system-transform", event: "session-get-failed", sessionID: input.sessionID, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

async function ensureProjectContextInitialized(input: { service: ProjectContextService; client: OpenCodeClientLike; projectRoot: string; sessionID?: string; onMaintainerSessionCreated?: (sessionID: string) => void }): Promise<void> {
  const detection = await input.service.detect();
  const validation = detection.found ? await input.service.validateContext() : { ok: false, errors: ["missing context workspace"], warnings: [], checked: [] };
  const missingScaffold = !detection.found || validation.errors.some((error) => error.startsWith("Missing required context file:"));
  if (!missingScaffold) return;
  const init = await input.service.initProjectContext({ projectId: projectId(input.projectRoot), projectName: projectName(input.projectRoot) });
  await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "auto-init-scaffold", sessionID: input.sessionID, details: { created: init.created.length, skipped: init.skipped.length, errors: validation.errors.length } });
  if (!input.sessionID || initializationJobs.has(input.projectRoot)) return;
  const runner = new MaintainerSubsessionRunner(input.client);
  const runOptions = input.onMaintainerSessionCreated
    ? { timeoutMs: 180_000, onSessionCreated: input.onMaintainerSessionCreated }
    : { timeoutMs: 180_000 };
  const job = runner.run({
    kind: "initialize",
    title: "Project Context Initialize",
    callerSessionID: input.sessionID,
    callerAgent: "project-context-runtime",
    projectRoot: input.projectRoot,
    goal: "Initialize Project Context for this project on first startup by reading docs, architecture/design notes, package metadata, tests, and main source implementation.",
    payload: { scaffold_created: init.created, scaffold_skipped: init.skipped }
  }, runOptions).then(async (result) => {
    await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: result.ok ? "auto-init-maintainer-completed" : "auto-init-maintainer-failed", sessionID: input.sessionID, error: result.ok ? undefined : result.error });
  }).finally(() => {
    initializationJobs.delete(input.projectRoot);
  });
  initializationJobs.set(input.projectRoot, job);
  void job;
}

export function createProjectContextSystemTransformHook(input: { service: ProjectContextService; client: OpenCodeClientLike; projectRoot: string; onMaintainerSessionCreated?: (sessionID: string) => void }) {
  const hook = async (hookInput: { sessionID?: string; model: unknown }, output: { system: string[] }): Promise<void> => {
    if (!(await shouldInjectProjectContext(hookInput, input.client, input.projectRoot))) return;
    await ensureProjectContextInitialized({
      service: input.service,
      client: input.client,
      projectRoot: input.projectRoot,
      ...(hookInput.sessionID ? { sessionID: hookInput.sessionID } : {}),
      ...(input.onMaintainerSessionCreated ? { onMaintainerSessionCreated: input.onMaintainerSessionCreated } : {})
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
    if (sessionID !== undefined) preparedSessions.set(sessionID, { ...previous, revision, briefText: brief.text, systemBriefPending: false });
    output.system.push(`${RUNTIME_RULE}\n\n${brief.text}`);
    await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "auto-prepare", sessionID: hookInput.sessionID, details: { estimatedTokens: brief.estimatedTokens, warnings: brief.warnings.length } });
  };
  hook.visibleChatMessage = async (hookInput: { sessionID?: string; agent?: string; model?: unknown }, output: { message?: unknown; parts?: unknown[] }): Promise<void> => {
    if (!(await shouldInjectProjectContext(hookInput, input.client, input.projectRoot))) return;
    await ensureProjectContextInitialized({
      service: input.service,
      client: input.client,
      projectRoot: input.projectRoot,
      ...(hookInput.sessionID ? { sessionID: hookInput.sessionID } : {}),
      ...(input.onMaintainerSessionCreated ? { onMaintainerSessionCreated: input.onMaintainerSessionCreated } : {})
    });
    const sessionID = hookInput.sessionID;
    if (!sessionID) return;
    const revision = await contextRevision(input.projectRoot);
    const previous = preparedSessions.get(sessionID);
    if (previous?.visibleRevision === revision) return;
    const brief = previous?.revision === revision && previous.briefText !== undefined
      ? { text: previous.briefText, estimatedTokens: 0, warnings: [] }
      : await input.service.prepareContext({ goal: "Prepare automatic project context for the current user task.", budget: "compact" });
    preparedSessions.set(sessionID, {
      ...previous,
      revision,
      visibleRevision: revision,
      briefText: brief.text,
      systemBriefPending: previous?.revision === revision ? previous.systemBriefPending === true : true
    });
    const messageID = readString(output.message, "id") ?? readString(output.parts?.[0], "messageID");
    const partSessionID = readString(output.message, "sessionID") ?? readString(output.parts?.[0], "sessionID") ?? sessionID;
    if (!messageID) {
      await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "visible-prepare-failed", sessionID, error: "OpenCode chat.message output did not expose a message id." });
      return;
    }
    output.parts ??= [];
    output.parts.push({
      id: partID(),
      sessionID: partSessionID,
      messageID,
      type: "text",
      synthetic: true,
      metadata: { kind: "project_context_prepare", revision: revisionLabel(revision) },
      text: visiblePrepareSummary({ revision, estimatedTokens: brief.estimatedTokens, warnings: brief.warnings, briefText: brief.text })
    });
    await writeRuntimeLog(input.projectRoot, { component: "system-transform", event: "visible-prepare-message", sessionID, details: { estimatedTokens: brief.estimatedTokens, warnings: brief.warnings.length } });
  };
  return hook;
}
