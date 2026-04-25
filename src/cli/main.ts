#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { ProjectContextService } from "../service/project-context-service.js";

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  const service = new ProjectContextService(process.cwd());
  try {
    switch (command) {
      case "doctor":
        return printDoctor(await service.validateContext());
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

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printDoctor(result: { ok: boolean }): void {
  printJson(result);
  if (!result.ok) process.exitCode = 1;
}

function printPrimer(primer: { text: string; warnings: string[] }): void {
  console.log(primer.text);
  if (primer.warnings.length > 0) console.error(`Warnings: ${primer.warnings.join("; ")}`);
}

async function printHelp(): Promise<void> {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { name: string; version: string };
  console.log(`${packageJson.name} ${packageJson.version}\n\nInternal commands:\n  doctor\n  primer [--budget 1000] [--memory-limit 3]\n\nProduct usage is automatic through the CrewBee/OpenCode runtime extension; this CLI is only for local diagnostics.`);
}

await main(process.argv.slice(2));
