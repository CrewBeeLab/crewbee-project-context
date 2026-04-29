import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveInstallRoot } from "../install/install-root.js";

export interface ProjectContextReleaseState {
  lastCheckedAt?: number | undefined;
  lastKnownVersion?: string | undefined;
  lastAttemptedVersion?: string | undefined;
  lastFailure?: string | undefined;
  lastFailureAt?: number | undefined;
  lastSucceededAt?: number | undefined;
}

export function readProjectContextReleaseState(): ProjectContextReleaseState {
  const filePath = resolveReleaseStatePath();
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed as ProjectContextReleaseState : {};
  } catch {
    return {};
  }
}

export function writeProjectContextReleaseState(state: ProjectContextReleaseState): void {
  const filePath = resolveReleaseStatePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function acquireProjectContextReleaseLock(): boolean {
  const filePath = resolveReleaseLockPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    writeFileSync(filePath, String(Date.now()), { encoding: "utf8", flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

export function releaseProjectContextReleaseLock(): void {
  const filePath = resolveReleaseLockPath();
  if (!existsSync(filePath)) return;
  try {
    unlinkSync(filePath);
  } catch {
    // ignore cleanup failures
  }
}

function resolveReleaseStatePath(): string {
  return path.join(resolveInstallRoot(), "crewbee-project-context-release-state.json");
}

function resolveReleaseLockPath(): string {
  return path.join(resolveInstallRoot(), "crewbee-project-context-release-refresh.lock");
}
