import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { PRIVATE_RUNTIME_CONTEXT_DIR } from "../../core/constants.js";
import { redactPrivateContextPaths } from "./visibility.js";

const execFileAsync = promisify(execFile);

export interface RecordedToolEvent {
  tool: string;
  reason: string;
  argsSummary: string;
  resultSummary?: string;
  timestamp: string;
}

export interface UpdateJobPayload {
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

export interface GitUpdateSummary {
  status: string;
  diffStat: string;
  stagedDiffStat: string;
  changedFiles: string[];
}

export function truncateUpdateText(text: string, maxLength = 4000): string {
  const redacted = redactPrivateContextPaths(text.trim());
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength)}\n[truncated]`;
}

export function summarizeUnknownForUpdate(value: unknown, maxLength = 1200): string {
  try {
    if (typeof value === "string") return truncateUpdateText(value, maxLength);
    return truncateUpdateText(JSON.stringify(value ?? {}, null, 2), maxLength);
  } catch (error) {
    return truncateUpdateText(error instanceof Error ? `unserializable: ${error.message}` : "unserializable value", maxLength);
  }
}

export function createUpdateJobID(): string {
  return `pcu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function updateJobPath(projectRoot: string, jobID: string): string {
  return path.join(projectRoot, PRIVATE_RUNTIME_CONTEXT_DIR, "cache", "update-jobs", `${jobID}.json`);
}

export function matchingLines(text: string, pattern: RegExp, limit = 8): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => pattern.test(line)).slice(0, limit).map((line) => truncateUpdateText(line, 500));
}

async function gitOutput(projectRoot: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, { cwd: projectRoot, timeout: 5000, windowsHide: true, maxBuffer: 128 * 1024 });
    return truncateUpdateText([result.stdout, result.stderr].filter(Boolean).join("\n") || "(empty)", 6000);
  } catch (error) {
    return truncateUpdateText(error instanceof Error ? `unavailable: git ${args.join(" ")} failed: ${error.message}` : `unavailable: git ${args.join(" ")} failed`, 1000);
  }
}

function uniqueNonEmpty(lines: string[]): string[] {
  return [...new Set(lines.map((line) => line.trim()).filter(Boolean))];
}

export async function collectGitUpdateSummary(projectRoot: string): Promise<GitUpdateSummary> {
  const status = await gitOutput(projectRoot, ["status", "--short"]);
  const diffStat = await gitOutput(projectRoot, ["diff", "--stat"]);
  const stagedDiffStat = await gitOutput(projectRoot, ["diff", "--cached", "--stat"]);
  const changedFiles = uniqueNonEmpty([
    ...(await gitOutput(projectRoot, ["diff", "--name-only"])).split(/\r?\n/),
    ...(await gitOutput(projectRoot, ["diff", "--cached", "--name-only"])).split(/\r?\n/),
    ...status.split(/\r?\n/).map((line) => line.slice(3).trim())
  ]).filter((line) => !line.startsWith("unavailable:"));
  return { status, diffStat, stagedDiffStat, changedFiles };
}
