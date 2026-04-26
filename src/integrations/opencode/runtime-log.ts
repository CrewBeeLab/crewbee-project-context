import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface ProjectContextRuntimeLogEvent {
  event: string;
  component: "system-transform" | "tool-guard" | "maintainer-runner";
  sessionID?: string | undefined;
  agent?: string | undefined;
  tool?: string | undefined;
  runId?: string | undefined;
  elapsedMs?: number | undefined;
  details?: Record<string, unknown> | undefined;
  error?: string | undefined;
}

const LOG_DIR = path.join(".local", "crewbee-project-context");
const LOG_FILE = "runtime.jsonl";

export async function writeRuntimeLog(projectRoot: string, event: ProjectContextRuntimeLogEvent): Promise<void> {
  const logDir = path.join(projectRoot, LOG_DIR);
  const logPath = path.join(logDir, LOG_FILE);
  try {
    await mkdir(logDir, { recursive: true });
    await appendFile(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`, "utf8");
  } catch (logError) {
    void logError; // Diagnostics must never affect runtime behavior.
  }
}
