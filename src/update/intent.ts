import path from "node:path";
import { readOpenCodeConfig } from "../install/config-writer.js";
import { resolveInstallRoot, resolveOpenCodeConfigPath } from "../install/install-root.js";
import { PROJECT_CONTEXT_PACKAGE_NAME } from "../install/plugin-entry.js";
import type { ProjectContextReleaseIntent } from "./types.js";

const EXACT_SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export function findConfiguredProjectContextReleaseIntent(): ProjectContextReleaseIntent | undefined {
  const configPath = resolveOpenCodeConfigPath();
  const config = readOpenCodeConfig(configPath).config;
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  for (const entry of plugins) {
    if (typeof entry !== "string") continue;
    if (entry === PROJECT_CONTEXT_PACKAGE_NAME) {
      return {
        configPath,
        entry,
        packageName: PROJECT_CONTEXT_PACKAGE_NAME,
        requestedVersion: "latest",
        channel: "latest",
        isPinned: false,
        workspaceRoot: resolveReleaseWorkspaceRoot(`${PROJECT_CONTEXT_PACKAGE_NAME}@latest`)
      };
    }
    if (!entry.startsWith(`${PROJECT_CONTEXT_PACKAGE_NAME}@`)) continue;
    const requestedVersion = entry.slice(PROJECT_CONTEXT_PACKAGE_NAME.length + 1).trim();
    if (!requestedVersion) continue;
    const isPinned = EXACT_SEMVER_REGEX.test(requestedVersion);
    return {
      configPath,
      entry,
      packageName: PROJECT_CONTEXT_PACKAGE_NAME,
      requestedVersion,
      channel: isPinned ? "latest" : requestedVersion,
      isPinned,
      workspaceRoot: resolveReleaseWorkspaceRoot(entry)
    };
  }
  return undefined;
}

function resolveReleaseWorkspaceRoot(entry: string): string {
  return path.join(resolveInstallRoot(), "packages", sanitizePackageSpec(entry));
}

function sanitizePackageSpec(value: string): string {
  const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined;
  if (!illegal) return value;
  return Array.from(value, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("");
}
