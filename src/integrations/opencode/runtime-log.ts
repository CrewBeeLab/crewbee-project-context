import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ProjectContextRuntimeLogEvent {
  event: string;
  component: "system-transform" | "tool-guard" | "maintainer-runner" | "auto-update";
  sessionID?: string | undefined;
  agent?: string | undefined;
  tool?: string | undefined;
  runId?: string | undefined;
  elapsedMs?: number | undefined;
  details?: Record<string, unknown> | undefined;
  error?: string | undefined;
}

function opencodeLogDir(): string {
  const dataHome = process.env.XDG_DATA_HOME;
  const root = dataHome ? path.join(dataHome, "opencode", "log") : path.join(os.homedir(), ".local", "share", "opencode", "log");
  return path.join(root, "crewbee");
}

function safeFileToken(value: string): string {
  const token = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return token.length > 0 ? token.slice(0, 120) : "runtime";
}

function logFileName(event: ProjectContextRuntimeLogEvent): string {
  return `crewbee-project-context-${safeFileToken(event.sessionID ?? "runtime")}.log`;
}

function formatLogLine(event: ProjectContextRuntimeLogEvent): string {
  const fields = [
    new Date().toISOString(),
    event.component,
    event.event,
    event.sessionID ? `session=${event.sessionID}` : undefined,
    event.agent ? `agent=${event.agent}` : undefined,
    event.tool ? `tool=${event.tool}` : undefined,
    event.runId ? `run=${event.runId}` : undefined,
    event.elapsedMs !== undefined ? `elapsed=${event.elapsedMs}ms` : undefined,
    event.error ? `error=${event.error}` : undefined,
    event.details ? `details=${Object.entries(event.details).map(([key, value]) => `${key}=${String(value)}`).join(" ")}` : undefined
  ];
  return fields.filter((field): field is string => typeof field === "string" && field.length > 0).join(" ");
}

export async function writeRuntimeLog(_projectRoot: string, event: ProjectContextRuntimeLogEvent): Promise<void> {
  const logDir = opencodeLogDir();
  const logPath = path.join(logDir, logFileName(event));
  try {
    await mkdir(logDir, { recursive: true });
    await appendFile(logPath, `${formatLogLine(event)}\n`, "utf8");
  } catch (logError) {
    void logError; // Diagnostics must never affect runtime behavior.
  }
}
