import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const PROJECT_CONTEXT_PACKAGE_NAME = "crewbee-project-context";
export const PROJECT_CONTEXT_PLUGIN_ENTRY = `${PROJECT_CONTEXT_PACKAGE_NAME}@0.1.1`;

export function resolveInstalledPackageRoot(installRoot: string): string {
  return path.join(installRoot, "node_modules", PROJECT_CONTEXT_PACKAGE_NAME);
}

export function resolveInstalledPluginPath(installRoot: string): string {
  return path.join(resolveInstalledPackageRoot(installRoot), "opencode-plugin.mjs");
}

export function resolveInstalledPackageRootCandidates(installRoot: string): string[] {
  const candidates: string[] = [];
  const packageCacheRoot = path.join(installRoot, "packages");
  if (existsSync(packageCacheRoot)) {
    for (const entry of readdirSync(packageCacheRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(`${PROJECT_CONTEXT_PACKAGE_NAME}@`)) {
        candidates.push(path.join(packageCacheRoot, entry.name, "node_modules", PROJECT_CONTEXT_PACKAGE_NAME));
      }
    }
  }
  candidates.push(resolveInstalledPackageRoot(installRoot));
  return candidates;
}

export function detectInstalledPackageRoot(installRoot: string): string {
  for (const candidate of resolveInstalledPackageRootCandidates(installRoot)) {
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return resolveInstalledPackageRoot(installRoot);
}

export function detectInstalledPluginPath(installRoot: string): string {
  return path.join(detectInstalledPackageRoot(installRoot), "opencode-plugin.mjs");
}

export function createCanonicalPluginEntry(): string {
  return PROJECT_CONTEXT_PLUGIN_ENTRY;
}

export function assertInstalledPluginExists(installRoot: string): void {
  const pluginPath = detectInstalledPluginPath(installRoot);
  if (!existsSync(pluginPath)) throw new Error(`crewbee-project-context plugin entry does not exist at ${pluginPath}.`);
}
