import type { CrewBeePromptFragment } from "../../core/types.js";
import { ProjectContextService } from "../../service/project-context-service.js";

export async function buildCrewBeeProjectContextPromptFragment(service: ProjectContextService): Promise<CrewBeePromptFragment> {
  const detection = await service.detect();
  if (!detection.found) {
    return { enabled: false, text: "", sourceFiles: [], warnings: ["Project Context not detected."] };
  }
  const capsule = await service.buildPrimer();
  return { enabled: true, text: capsule.text, sourceFiles: capsule.sourceFiles, warnings: capsule.warnings };
}
