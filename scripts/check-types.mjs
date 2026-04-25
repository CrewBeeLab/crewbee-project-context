import * as api from "../dist/src/index.js";

const required = [
  "prepareProjectContext",
  "searchProjectContext",
  "requestProjectContextFinalize",
  "createCrewBeeProjectContextExtension",
  "buildCrewBeePromptFragment",
  "getCrewBeeToolNames",
  "executeCrewBeeProjectContextTool"
];

const missing = required.filter((name) => typeof api[name] !== "function");
if (missing.length > 0) {
  console.error(`Missing API exports: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("API surface check passed.");
