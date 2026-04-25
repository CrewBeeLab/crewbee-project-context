import { readFileSync } from "node:fs";
import path from "node:path";
import { readOpenCodeConfig, upsertProjectContextPluginEntry, writeOpenCodeConfig } from "./config-writer.js";
import { resolveOpenCodeConfigPath, resolveInstallRoot } from "./install-root.js";
import { resolveLocalTarballPath } from "./local-tarball.js";
import { installLocalTarball, installRegistryPackage } from "./package-manager.js";
import { assertInstalledPluginExists, createCanonicalPluginEntry, PROJECT_CONTEXT_PACKAGE_NAME } from "./plugin-entry.js";
import type { InstallCommandContext, InstallCommandOptions, InstallResult } from "./types.js";
import { ensureInstallWorkspace } from "./workspace.js";

export async function installProjectContext(input: { context: InstallCommandContext; options: InstallCommandOptions }): Promise<InstallResult> {
  const configPath = resolveOpenCodeConfigPath(input.options.configPath);
  const installRoot = resolveInstallRoot(input.options.installRoot);
  const workspace = ensureInstallWorkspace(installRoot, input.options.dryRun);
  const version = readPackageVersion(input.context.packageRoot);
  let tarballPath: string | undefined;
  let packageSpec: string | undefined;

  if (input.options.source === "local") {
    tarballPath = resolveLocalTarballPath({
      ...(input.options.localTarballPath ? { localTarballPath: input.options.localTarballPath } : {}),
      searchRoots: [input.context.cwd, input.context.packageRoot]
    });
    installLocalTarball({ dryRun: input.options.dryRun, installRoot, tarballPath });
  } else {
    packageSpec = `${PROJECT_CONTEXT_PACKAGE_NAME}@${version}`;
    installRegistryPackage({ dryRun: input.options.dryRun, installRoot, packageSpec });
  }

  if (!input.options.dryRun) assertInstalledPluginExists(installRoot);

  const pluginEntry = createCanonicalPluginEntry();
  const configDocument = readOpenCodeConfig(configPath);
  const pluginUpdate = upsertProjectContextPluginEntry(configDocument.config, pluginEntry);
  if (!input.options.dryRun && pluginUpdate.changed) writeOpenCodeConfig(configPath, configDocument.config);

  return {
    configChanged: pluginUpdate.changed,
    configPath,
    dryRun: input.options.dryRun,
    installRoot,
    migratedEntries: pluginUpdate.migratedEntries,
    ...(packageSpec ? { packageSpec } : {}),
    pluginEntry,
    source: input.options.source,
    ...(tarballPath ? { tarballPath } : {}),
    workspaceCreated: workspace.created
  };
}

function readPackageVersion(packageRoot: string): string {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) throw new Error("package.json must include a version.");
  return manifest.version;
}
