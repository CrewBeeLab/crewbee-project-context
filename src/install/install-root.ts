import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function defaultConfigRoot(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configHome = xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode");
}

function hasExistingOpenCodeConfig(root: string): boolean {
  return existsSync(path.join(root, "opencode.json")) || existsSync(path.join(root, "opencode.jsonc"));
}

export function resolveOpenCodeConfigRoot(configPath?: string): string {
  if (configPath) return path.dirname(path.resolve(configPath));
  const overrideRoot = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (overrideRoot) return path.resolve(overrideRoot);

  const crossPlatformRoot = defaultConfigRoot();
  if (process.platform !== "win32" || hasExistingOpenCodeConfig(crossPlatformRoot)) return crossPlatformRoot;

  const appDataRoot = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "opencode");
  return hasExistingOpenCodeConfig(appDataRoot) ? appDataRoot : crossPlatformRoot;
}

export function resolveOpenCodeConfigPath(configPath?: string): string {
  if (configPath) return path.resolve(configPath);
  const root = resolveOpenCodeConfigRoot();
  const jsoncPath = path.join(root, "opencode.jsonc");
  return existsSync(jsoncPath) ? jsoncPath : path.join(root, "opencode.json");
}

export function resolveInstallRoot(installRoot?: string): string {
  if (installRoot) return path.resolve(installRoot);
  const xdgCacheHome = process.env.XDG_CACHE_HOME;
  const cacheRoot = xdgCacheHome && xdgCacheHome.length > 0 ? xdgCacheHome : path.join(os.homedir(), ".cache");
  return path.join(cacheRoot, "opencode");
}
