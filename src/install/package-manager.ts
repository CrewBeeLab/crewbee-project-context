import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_CONTEXT_PACKAGE_NAME, PROJECT_CONTEXT_PLUGIN_ENTRY } from "./plugin-entry.js";

function runNpmCommand(args: string[]): number {
  const npmCommand = resolveNpmCommand();
  const result = spawnSync(npmCommand.command, [...npmCommand.argsPrefix, ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function resolveNpmCommand(): { command: string; argsPrefix: string[] } {
  if (process.platform !== "win32") return { command: "npm", argsPrefix: [] };
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const cli = path.join(dir, "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(cli)) return { command: process.execPath, argsPrefix: [cli] };
    for (const name of ["npm", "npm.cmd", "npm.exe"]) {
      const executable = path.join(dir, name);
      const adjacentCli = path.join(path.dirname(executable), "node_modules", "npm", "bin", "npm-cli.js");
      if (existsSync(adjacentCli)) return { command: process.execPath, argsPrefix: [adjacentCli] };
    }
  }
  return { command: "npm", argsPrefix: [] };
}

function installPackageSpec(input: { dryRun: boolean; installRoot: string; packageSpec: string }): void {
  if (input.dryRun) return;
  const exitCode = runNpmCommand(["install", "--prefix", input.installRoot, input.packageSpec, "--no-audit", "--no-fund"]);
  if (exitCode !== 0) throw new Error(`npm install failed with exit code ${exitCode}.`);
}

export function installLocalTarball(input: { dryRun: boolean; installRoot: string; tarballPath: string }): void {
  installPackageSpec({ dryRun: input.dryRun, installRoot: input.installRoot, packageSpec: input.tarballPath });
  syncOpenCodePackageCache(input);
}

export function installRegistryPackage(input: { dryRun: boolean; installRoot: string; packageSpec: string }): void {
  installPackageSpec(input);
  syncOpenCodePackageCache(input);
}

function syncOpenCodePackageCache(input: { dryRun: boolean; installRoot: string }): void {
  if (input.dryRun) return;
  const installedRoot = path.join(input.installRoot, "node_modules", PROJECT_CONTEXT_PACKAGE_NAME);
  cleanupOpenCodePackageCaches(input.installRoot);
  if (!existsSync(path.join(installedRoot, "package.json"))) return;
  const packageCacheRoot = path.join(input.installRoot, "packages", PROJECT_CONTEXT_PLUGIN_ENTRY);
  const cachedPackageRoot = path.join(packageCacheRoot, "node_modules", PROJECT_CONTEXT_PACKAGE_NAME);
  rmSync(packageCacheRoot, { recursive: true, force: true });
  mkdirSync(path.dirname(cachedPackageRoot), { recursive: true });
  cpSync(installedRoot, cachedPackageRoot, { recursive: true });
  rmSync(installedRoot, { recursive: true, force: true });
  writeFileSync(path.join(packageCacheRoot, "package.json"), JSON.stringify({ private: true, dependencies: { [PROJECT_CONTEXT_PACKAGE_NAME]: "file:./node_modules/crewbee-project-context" } }, null, 2));
}

export function cleanupOpenCodePackageCaches(installRoot: string): void {
  const packageCacheRoot = path.join(installRoot, "packages");
  if (!existsSync(packageCacheRoot)) return;
  for (const entry of readdirSafe(packageCacheRoot)) {
    if (entry.startsWith(`${PROJECT_CONTEXT_PACKAGE_NAME}@`) && entry !== PROJECT_CONTEXT_PLUGIN_ENTRY) {
      rmSync(path.join(packageCacheRoot, entry), { recursive: true, force: true });
    }
  }
}

function readdirSafe(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}
