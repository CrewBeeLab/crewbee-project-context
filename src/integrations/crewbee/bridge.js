import { buildPrimer } from "../../primer/build-primer.js";
import { searchContext } from "../../search/search.js";
import { finalizeSession } from "../../finalize/finalize-session.js";
import { detect, readContextFile } from "../../store/file-system-store.js";

export async function buildCrewBeePromptFragment(root = process.cwd(), options = {}) {
  const detection = await detect(root, options);
  if (!detection.found) {
    return {
      enabled: false,
      text: "",
      sourceFiles: [],
      warnings: ["Project Context not detected."]
    };
  }
  const primer = await buildPrimer(root, options);
  return {
    enabled: true,
    text: primer.text,
    sourceFiles: primer.sourceFiles,
    warnings: primer.warnings
  };
}

export function getCrewBeeToolNames() {
  return [
    "project_context_read",
    "project_context_search",
    "project_context_finalize"
  ];
}

export async function executeCrewBeeProjectContextTool(root = process.cwd(), name, input = {}, options = {}) {
  switch (name) {
    case "project_context_read":
      return readContextFile(root, input.path ?? ".crewbee/HANDOFF.md", options);
    case "project_context_search":
      return searchContext(root, input.query ?? "", { ...options, limit: input.limit });
    case "project_context_finalize":
      return finalizeSession(root, input, options);
    default:
      throw new Error(`Unknown CrewBee Project Context tool: ${name}`);
  }
}
