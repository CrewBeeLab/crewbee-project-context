import * as api from "../src/index.js";

const required = [
  "detect",
  "initProjectContext",
  "migrateProjectContext",
  "validateContext",
  "buildPrimer",
  "searchContext",
  "readContextFile",
  "updateContext",
  "finalizeSession",
  "buildCrewBeePromptFragment",
  "executeCrewBeeProjectContextTool"
];

const missing = required.filter((name) => typeof api[name] !== "function");
if (missing.length > 0) {
  console.error(`Missing API exports: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("API surface check passed.");
