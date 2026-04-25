import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { findProjectContextPluginEntries, hasRecommendedPluginOrder, readOpenCodeConfig } from "./config-writer.js";
import { resolveOpenCodeConfigPath, resolveInstallRoot } from "./install-root.js";
import { createCanonicalPluginEntry, detectInstalledPackageRoot, detectInstalledPluginPath } from "./plugin-entry.js";
import type { DoctorOptions, DoctorResult } from "./types.js";

interface OpenCodePluginModule {
  default?: { server?: unknown };
  server?: unknown;
}

export async function runInstallDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const configPath = resolveOpenCodeConfigPath(options.configPath);
  const installRoot = resolveInstallRoot(options.installRoot);
  const expectedPluginEntry = createCanonicalPluginEntry();
  const installedPackageRoot = detectInstalledPackageRoot(installRoot);
  const pluginPath = detectInstalledPluginPath(installRoot);
  const config = readOpenCodeConfig(configPath).config;
  const currentPluginEntries = findProjectContextPluginEntries(config);
  const hasWorkspaceManifest = existsSync(path.join(installRoot, "package.json"));
  const hasInstalledPackage = existsSync(path.join(installedPackageRoot, "package.json"));
  const hasPluginFile = existsSync(pluginPath);
  const configMatchesCanonical = currentPluginEntries.length === 1 && currentPluginEntries[0] === expectedPluginEntry;
  const pluginSurface = hasPluginFile ? await inspectPluginSurface(pluginPath, installRoot) : emptyPluginSurface();
  const orderOk = hasRecommendedPluginOrder(config);
  const healthy = hasWorkspaceManifest && hasInstalledPackage && hasPluginFile && configMatchesCanonical && orderOk && pluginSurface.hasHiddenMaintainerAgent && pluginSurface.hasThreeToolSurface && pluginSurface.noProjectContextReadTool && pluginSurface.noCompactionHook && pluginSurface.maintainerTaskDeniedForPrimaryAgent;

  return {
    configPath,
    configMatchesCanonical,
    currentPluginEntries,
    expectedPluginEntry,
    hasHiddenMaintainerAgent: pluginSurface.hasHiddenMaintainerAgent,
    hasInstalledPackage,
    hasPluginFile,
    hasRecommendedPluginOrder: orderOk,
    hasThreeToolSurface: pluginSurface.hasThreeToolSurface,
    hasWorkspaceManifest,
    healthy,
    installedPackageRoot,
    installRoot,
    maintainerTaskDeniedForPrimaryAgent: pluginSurface.maintainerTaskDeniedForPrimaryAgent,
    noCompactionHook: pluginSurface.noCompactionHook,
    noProjectContextReadTool: pluginSurface.noProjectContextReadTool
  };
}

function emptyPluginSurface() {
  return {
    hasHiddenMaintainerAgent: false,
    hasThreeToolSurface: false,
    maintainerTaskDeniedForPrimaryAgent: false,
    noCompactionHook: false,
    noProjectContextReadTool: false
  };
}

async function inspectPluginSurface(pluginPath: string, worktree: string): Promise<ReturnType<typeof emptyPluginSurface>> {
  const mod = await import(`${pathToFileURL(pluginPath).href}?doctor=${Date.now()}`) as OpenCodePluginModule;
  const server = typeof mod.server === "function" ? mod.server : typeof mod.default?.server === "function" ? mod.default.server : undefined;
  if (!server) return emptyPluginSurface();

  const hooks = await server({ client: createMockOpenCodeClient(), worktree, directory: worktree });
  const config: Record<string, unknown> = { agent: { "coding-leader": { mode: "primary", permission: {} } } };
  if (typeof hooks.config === "function") await hooks.config(config);
  const agents = readRecord(config.agent);
  const maintainer = readRecord(agents["project-context-maintainer"]);
  const leader = readRecord(agents["coding-leader"]);
  const leaderPermission = readRecord(leader.permission);
  const taskPermission = readRecord(leaderPermission.task);
  const toolNames = hooks.tool && typeof hooks.tool === "object" && !Array.isArray(hooks.tool) ? Object.keys(hooks.tool as Record<string, unknown>).sort() : [];

  return {
    hasHiddenMaintainerAgent: maintainer.mode === "subagent" && maintainer.hidden === true,
    hasThreeToolSurface: toolNames.join("|") === "project_context_finalize|project_context_prepare|project_context_search",
    maintainerTaskDeniedForPrimaryAgent: taskPermission["project-context-maintainer"] === "deny",
    noCompactionHook: !("experimental.session.compacting" in readRecord(hooks)),
    noProjectContextReadTool: !toolNames.includes("project_context_read")
  };
}

function createMockOpenCodeClient() {
  return {
    session: {
      async create() {
        return { id: "doctor-maintainer-session" };
      },
      async prompt() {
        return {};
      },
      async messages() {
        return [{ role: "assistant", parts: [{ type: "text", text: "doctor maintainer result" }] }];
      }
    }
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
