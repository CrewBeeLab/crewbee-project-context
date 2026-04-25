#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { buildPrimer, detect, finalizeSession, initProjectContext, readContextFile, searchContext, updateContext, validateContext } from "../index.js";
import type { ContextPatch, SessionSummary } from "../core/types.js";

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case "init":
        return printJson(await initProjectContext(process.cwd(), parseInitOptions(args)));
      case "doctor":
        return printDoctor(await validateContext(process.cwd()));
      case "primer":
        return printPrimer(await buildPrimer(process.cwd(), parsePrimerOptions(args)));
      case "read":
        return printRead(await readContextFile(process.cwd(), args[0] ?? ".crewbee/HANDOFF.md"));
      case "search":
        return printJson(await searchContext(process.cwd(), args.join(" ")));
      case "update":
        return printJson(await updateContext(process.cwd(), parseUpdatePatch(args)));
      case "finalize":
        return printJson(await finalizeSession(process.cwd(), parseFinalizeSummary(args)));
      case "detect":
        return printJson(await detect(process.cwd()));
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

function parseInitOptions(args: string[]): { projectName?: string; projectId?: string; force?: boolean } {
  const options: { projectName?: string; projectId?: string; force?: boolean } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project-name") {
      const value = args[++index];
      if (value !== undefined) options.projectName = value;
    } else if (arg === "--project-id") {
      const value = args[++index];
      if (value !== undefined) options.projectId = value;
    }
    else if (arg === "--force") options.force = true;
  }
  return options;
}

function parsePrimerOptions(args: string[]): { budgetTokens?: number; memoryLimit?: number } {
  const options: { budgetTokens?: number; memoryLimit?: number } = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--budget") options.budgetTokens = Number(args[++index]);
    if (args[index] === "--memory-limit") options.memoryLimit = Number(args[++index]);
  }
  return options;
}

function parseUpdatePatch(args: string[]): ContextPatch {
  const [target, operation = "merge", ...rest] = args;
  if (!isPatchTarget(target)) throw new Error("update target must be state, handoff, memory, or decision");
  if (!isPatchOperation(operation)) throw new Error("update operation must be merge, replace, or append");
  const payload: Record<string, string> = {};
  let expectedHash: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--expected-hash") expectedHash = rest[++index];
    else if (arg?.startsWith("--")) payload[arg.slice(2).replaceAll("-", "_")] = rest[++index] ?? "";
  }
  return expectedHash ? { target, operation, payload, expectedHash } : { target, operation, payload };
}

function parseFinalizeSummary(args: string[]): SessionSummary {
  const summary: SessionSummary = { changedFiles: [], verification: [], nextActions: [], blockers: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--title") {
      const value = args[++index];
      if (value !== undefined) summary.title = value;
    } else if (arg === "--summary") {
      const value = args[++index];
      if (value !== undefined) summary.summary = value;
    }
    else if (arg === "--changed-file") summary.changedFiles?.push(args[++index] ?? "");
    else if (arg === "--verification") summary.verification?.push(args[++index] ?? "");
    else if (arg === "--next-action") summary.nextActions?.push(args[++index] ?? "");
    else if (arg === "--blocker") summary.blockers?.push(args[++index] ?? "");
  }
  return summary;
}

function isPatchTarget(value: string | undefined): value is ContextPatch["target"] {
  return value === "state" || value === "handoff" || value === "memory" || value === "decision";
}

function isPatchOperation(value: string): value is NonNullable<ContextPatch["operation"]> {
  return value === "merge" || value === "replace" || value === "append";
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

function printRead(result: { text: string }): void {
  console.log(result.text);
}

async function printHelp(): Promise<void> {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { name: string; version: string };
  console.log(`${packageJson.name} ${packageJson.version}\n\nCommands:\n  init [--project-name name] [--project-id id] [--force]\n  doctor\n  primer [--budget 1000]\n  read .crewbee/HANDOFF.md\n  search <query>\n  update <state|handoff|memory|decision> [merge|replace|append] --key value\n  finalize --summary text [--verification text] [--next-action text]\n  detect`);
}

await main(process.argv.slice(2));
