import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

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
}

export function installRegistryPackage(input: { dryRun: boolean; installRoot: string; packageSpec: string }): void {
  installPackageSpec(input);
}
