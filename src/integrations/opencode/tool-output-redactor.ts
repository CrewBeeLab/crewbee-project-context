import { isProjectContextMaintainer, redactPrivateContextPathsDeep } from "./visibility.js";

export function createProjectContextToolOutputRedactor() {
  return async (input: { agent?: string }, output: { result?: unknown; [key: string]: unknown }): Promise<void> => {
    if (isProjectContextMaintainer(input.agent)) return;
    if ("result" in output) output.result = redactPrivateContextPathsDeep(output.result);
  };
}
