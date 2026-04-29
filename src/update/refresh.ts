import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenCodePluginInputLike } from "../integrations/opencode/types.js";
import { writeRuntimeLog } from "../integrations/opencode/runtime-log.js";
import { findConfiguredProjectContextReleaseIntent } from "./intent.js";
import { fetchTargetVersion } from "./registry.js";
import { acquireProjectContextReleaseLock, readProjectContextReleaseState, releaseProjectContextReleaseLock, writeProjectContextReleaseState } from "./state.js";
import { readInstalledWorkspaceVersion, syncWorkspaceDependencyIntent } from "./workspace.js";
import type { ProjectContextReleaseCheckResult, ProjectContextReleaseRefreshDependencies } from "./types.js";

const SUCCESS_RECHECK_MS = 60 * 60 * 1000;
const FAILURE_RECHECK_MS = 30 * 60 * 1000;

export function startBackgroundReleaseRefresh(ctx: OpenCodePluginInputLike, projectRoot: string, deps: ProjectContextReleaseRefreshDependencies = createDefaultDependencies()): void {
  if (!shouldEnableProjectContextReleaseRefresh()) return;
  queueMicrotask(() => {
    void runBackgroundReleaseRefresh(ctx, projectRoot, deps).catch(() => undefined);
  });
}

export async function runBackgroundReleaseRefresh(_ctx: OpenCodePluginInputLike, projectRoot: string, deps: ProjectContextReleaseRefreshDependencies): Promise<ProjectContextReleaseCheckResult> {
  if (!acquireProjectContextReleaseLock()) {
    await writeRuntimeLog(projectRoot, { component: "release-refresh", event: "skipped", details: { reason: "lock-held" } });
    return { needsRefresh: false, reason: "up-to-date" };
  }
  try {
    const intent = findConfiguredProjectContextReleaseIntent();
    if (!intent) {
      await writeRuntimeLog(projectRoot, { component: "release-refresh", event: "skipped", details: { reason: "plugin-not-configured" } });
      return { needsRefresh: false, reason: "plugin-not-configured" };
    }
    const state = readProjectContextReleaseState();
    const now = Date.now();
    const currentVersion = readInstalledWorkspaceVersion(intent.workspaceRoot) ?? state.lastKnownVersion;
    if (shouldSkipByCooldown(state, now)) {
      await writeRuntimeLog(projectRoot, { component: "release-refresh", event: "skipped", details: { reason: "cooldown", currentVersion } });
      return { currentVersion, needsRefresh: false, reason: "up-to-date" };
    }
    if (intent.isPinned) {
      await writeRuntimeLog(projectRoot, { component: "release-refresh", event: "skipped", details: { reason: "pinned-version", requestedVersion: intent.requestedVersion, currentVersion } });
      return { currentVersion, latestVersion: intent.requestedVersion, needsRefresh: false, reason: "pinned-version" };
    }
    const latestVersion = await fetchTargetVersion({ intent, fetchJson: deps.fetchJson });
    if (!latestVersion) {
      writeProjectContextReleaseState({ ...state, lastCheckedAt: now });
      await writeRuntimeLog(projectRoot, { component: "release-refresh", event: "failed", details: { reason: "latest-unavailable", currentVersion } });
      return { currentVersion, needsRefresh: false, reason: "latest-unavailable" };
    }
    if (currentVersion === latestVersion) {
      writeProjectContextReleaseState({ ...state, lastCheckedAt: now, lastKnownVersion: currentVersion, lastFailure: undefined, lastFailureAt: undefined, lastSucceededAt: now });
      await writeRuntimeLog(projectRoot, { component: "release-refresh", event: "up-to-date", details: { currentVersion, latestVersion, workspaceRoot: intent.workspaceRoot } });
      return { currentVersion, latestVersion, needsRefresh: false, reason: "up-to-date" };
    }
    await writeRuntimeLog(projectRoot, { component: "release-refresh", event: "newer-version", details: { currentVersion, latestVersion, workspaceRoot: intent.workspaceRoot } });
    syncWorkspaceDependencyIntent(intent, latestVersion);
    const installed = await deps.runInstall(intent.workspaceRoot);
    if (!installed) {
      writeProjectContextReleaseState({ ...state, lastCheckedAt: now, lastAttemptedVersion: latestVersion, lastFailure: `Failed to install ${latestVersion}`, lastFailureAt: now, lastKnownVersion: currentVersion });
      await writeRuntimeLog(projectRoot, { component: "release-refresh", event: "install-failed", details: { currentVersion, latestVersion, workspaceRoot: intent.workspaceRoot } });
      return { currentVersion, latestVersion, needsRefresh: true, reason: "refresh-required" };
    }
    writeProjectContextReleaseState({ lastCheckedAt: now, lastAttemptedVersion: latestVersion, lastKnownVersion: latestVersion, lastFailure: undefined, lastFailureAt: undefined, lastSucceededAt: now });
    await writeRuntimeLog(projectRoot, { component: "release-refresh", event: "installed", details: { currentVersion, latestVersion, workspaceRoot: intent.workspaceRoot } });
    return { currentVersion, latestVersion, needsRefresh: true, reason: "refresh-required" };
  } finally {
    releaseProjectContextReleaseLock();
  }
}

export function shouldEnableProjectContextReleaseRefresh(currentPackageRoot: string = resolveCurrentPackageRoot()): boolean {
  const override = process.env.CREWBEE_PROJECT_CONTEXT_AUTO_UPDATE?.trim().toLowerCase();
  if (override === "1" || override === "true" || override === "on") return true;
  if (override === "0" || override === "false" || override === "off") return false;
  if (process.env.NODE_ENV === "test") return false;
  return !existsSync(path.join(currentPackageRoot, ".git"));
}

function shouldSkipByCooldown(state: ReturnType<typeof readProjectContextReleaseState>, now: number): boolean {
  if (state.lastFailureAt && now - state.lastFailureAt < FAILURE_RECHECK_MS) return true;
  if (state.lastSucceededAt && now - state.lastSucceededAt < SUCCESS_RECHECK_MS) return true;
  return false;
}

function resolveCurrentPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function createDefaultDependencies(): ProjectContextReleaseRefreshDependencies {
  return {
    async fetchJson(url: string) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
      return response.json();
    },
    async runInstall(workspaceRoot: string) {
      return new Promise<boolean>((resolve) => {
        const child = spawn("npm", ["install", "--prefix", workspaceRoot, "--no-audit", "--no-fund"], { shell: process.platform === "win32", stdio: "ignore" });
        child.on("error", () => resolve(false));
        child.on("exit", (code) => resolve(code === 0));
      });
    }
  };
}
