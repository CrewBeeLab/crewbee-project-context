#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectContextService } from "../service/project-context-service.js";
import { installProjectContext, runInstallDoctor } from "../install/index.js";
import type { InstallCommandOptions, InstallSource } from "../install/index.js";

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  const service = new ProjectContextService(process.cwd());
  try {
    switch (command) {
      case "install":
        return printJson(await installProjectContext({ context: { cwd: process.cwd(), packageRoot: findPackageRoot() }, options: parseInstallOptions(args) }));
      case "install:local:user":
        return printJson(await installProjectContext({ context: { cwd: process.cwd(), packageRoot: findPackageRoot() }, options: parseInstallOptions(args, "local") }));
      case "install:registry:user":
        return printJson(await installProjectContext({ context: { cwd: process.cwd(), packageRoot: findPackageRoot() }, options: parseInstallOptions(args, "registry") }));
      case "doctor":
        return printDoctor(await runInstallDoctor(parseDoctorOptions(args)));
      case "context:doctor":
        return printContextDoctor(await service.validateContext());
      case "primer":
        return printPrimer(await service.buildPrimer(parsePrimerOptions(args)));
      case "help":
      case undefined:
        return printHelp();
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function parsePrimerOptions(args: string[]): { budgetTokens?: number; memoryLimit?: number } {
  const options: { budgetTokens?: number; memoryLimit?: number } = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--budget") options.budgetTokens = Number(args[++index]);
    if (args[index] === "--memory-limit") options.memoryLimit = Number(args[++index]);
  }
  return options;
}

function parseInstallOptions(args: string[], forcedSource?: InstallSource): InstallCommandOptions {
  let configPath: string | undefined;
  let dryRun = false;
  let installRoot: string | undefined;
  let localTarballPath: string | undefined;
  let source: InstallSource = forcedSource ?? "local";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--config-path" || arg === "--config") {
      configPath = getOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--config-path=")) {
      configPath = arg.slice("--config-path=".length);
      continue;
    }
    if (arg?.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
      continue;
    }
    if (arg === "--install-root") {
      installRoot = getOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--install-root=")) {
      installRoot = arg.slice("--install-root=".length);
      continue;
    }
    if (arg === "--local-tarball" || arg === "--tarball") {
      localTarballPath = getOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--local-tarball=")) {
      localTarballPath = arg.slice("--local-tarball=".length);
      continue;
    }
    if (arg?.startsWith("--tarball=")) {
      localTarballPath = arg.slice("--tarball=".length);
      continue;
    }
    if (arg === "--source") {
      source = parseInstallSource(getOptionValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--source=")) {
      source = parseInstallSource(arg.slice("--source=".length));
      continue;
    }
    throw new Error(`Unknown install option '${arg}'.`);
  }

  return {
    dryRun,
    source,
    ...(configPath ? { configPath } : {}),
    ...(installRoot ? { installRoot } : {}),
    ...(localTarballPath ? { localTarballPath } : {})
  };
}

function parseDoctorOptions(args: string[]): { configPath?: string; installRoot?: string } {
  let configPath: string | undefined;
  let installRoot: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config-path" || arg === "--config") {
      configPath = getOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--config-path=")) {
      configPath = arg.slice("--config-path=".length);
      continue;
    }
    if (arg?.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
      continue;
    }
    if (arg === "--install-root") {
      installRoot = getOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--install-root=")) {
      installRoot = arg.slice("--install-root=".length);
      continue;
    }
    throw new Error(`Unknown doctor option '${arg}'.`);
  }
  return { ...(configPath ? { configPath } : {}), ...(installRoot ? { installRoot } : {}) };
}

function getOptionValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

function parseInstallSource(value: string): InstallSource {
  if (value === "local" || value === "registry") return value;
  throw new Error(`Unsupported install source '${value}'.`);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printDoctor(result: { healthy: boolean }): void {
  printJson(result);
  if (!result.healthy) process.exitCode = 1;
}

function printContextDoctor(result: { ok: boolean }): void {
  printJson(result);
  if (!result.ok) process.exitCode = 1;
}

function printPrimer(primer: { text: string; warnings: string[] }): void {
  console.log(primer.text);
  if (primer.warnings.length > 0) console.error(`Warnings: ${primer.warnings.join("; ")}`);
}

async function printHelp(): Promise<void> {
  const packageJson = JSON.parse(await readFile(path.join(findPackageRoot(), "package.json"), "utf8")) as { name: string; version: string };
  console.log(`${packageJson.name} ${packageJson.version}\n\nCommands:\n  install [--source <local|registry>] [--local-tarball <path>] [--install-root <path>] [--config-path <path>] [--dry-run]\n  install:local:user [--local-tarball <path>] [--install-root <path>] [--config-path <path>] [--dry-run]\n  install:registry:user [--install-root <path>] [--config-path <path>] [--dry-run]\n  doctor [--install-root <path>] [--config-path <path>]\n\nInternal diagnostics:\n  context:doctor\n  primer [--budget 1000] [--memory-limit 3]`);
}

function findPackageRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Unable to locate package.json for crewbee-project-context.");
}

await main(process.argv.slice(2));
