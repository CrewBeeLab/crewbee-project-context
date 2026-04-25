#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { buildPrimer, detect, finalizeSession, initProjectContext, migrateProjectContext, readContextFile, searchContext, updateContext, validateContext } from "../index.js";

async function main(argv) {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case "init":
        return printJson(await initProjectContext(process.cwd(), parseOptions(args)));
      case "migrate":
        return printJson(await migrateProjectContext(process.cwd(), parseMigrateOptions(args)));
      case "doctor":
        return printDoctor(await validateContext(process.cwd(), parseOptions(args)));
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
        return printJson(await detect(process.cwd(), parseOptions(args)));
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

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project-name") options.projectName = args[++index];
    else if (arg === "--project-id") options.projectId = args[++index];
    else if (arg === "--context-dir") options.contextDir = args[++index];
    else if (arg === "--force") options.force = true;
  }
  return options;
}

function parsePrimerOptions(args) {
  const options = parseOptions(args);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--budget") options.budgetTokens = Number(args[++index]);
    if (args[index] === "--memory-limit") options.memoryLimit = Number(args[++index]);
  }
  return options;
}

function parseMigrateOptions(args) {
  const options = parseOptions(args);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--from") options.from = args[++index];
    else if (args[index] === "--to") options.to = args[++index];
    else if (args[index] === "--remove-source") options.removeSource = true;
  }
  return options;
}

function parseUpdatePatch(args) {
  const [target, operation = "merge", ...rest] = args;
  const payload = {};
  let expectedHash;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--expected-hash") expectedHash = rest[++index];
    else if (arg.startsWith("--")) payload[arg.slice(2).replaceAll("-", "_")] = rest[++index];
  }
  return { target, operation, payload, expectedHash };
}

function parseFinalizeSummary(args) {
  const summary = { changedFiles: [], verification: [], nextActions: [], blockers: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--title") summary.title = args[++index];
    else if (arg === "--summary") summary.summary = args[++index];
    else if (arg === "--changed-file") summary.changedFiles.push(args[++index]);
    else if (arg === "--verification") summary.verification.push(args[++index]);
    else if (arg === "--next-action") summary.nextActions.push(args[++index]);
    else if (arg === "--blocker") summary.blockers.push(args[++index]);
  }
  return summary;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printDoctor(result) {
  printJson(result);
  if (!result.ok) process.exitCode = 1;
}

function printPrimer(primer) {
  console.log(primer.text);
  if (primer.warnings.length > 0) {
    console.error(`Warnings: ${primer.warnings.join("; ")}`);
  }
}

function printRead(result) {
  console.log(result.text);
}

async function printHelp() {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  console.log(`${packageJson.name} ${packageJson.version}\n\nCommands:\n  init [--project-name name] [--project-id id] [--force]\n  migrate [--from .agent] [--to .crewbee] [--force] [--remove-source]\n  doctor\n  primer [--budget 1000]\n  read .crewbee/HANDOFF.md\n  search <query>\n  update <state|handoff|memory|decision> [merge|replace|append] --key value\n  finalize --summary text [--verification text] [--next-action text]\n  detect`);
}

await main(process.argv.slice(2));
