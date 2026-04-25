import { ProjectContextService } from "../../service/project-context-service.js";
import { createProjectContextConfigHook } from "./config-hook.js";
import { createProjectContextSystemTransformHook } from "./system-transform-hook.js";
import { createProjectContextToolGuard } from "./tool-guard.js";
import { createProjectContextToolOutputRedactor } from "./tool-output-redactor.js";
import { createProjectContextTools } from "./tools.js";
import type { OpenCodePluginInputLike, OpenCodeV1PluginModuleLike } from "./types.js";

export async function server(ctx: OpenCodePluginInputLike) {
  const service = new ProjectContextService(ctx.worktree);
  return {
    config: createProjectContextConfigHook(),
    tool: createProjectContextTools({ client: ctx.client, service }),
    "experimental.chat.system.transform": createProjectContextSystemTransformHook(service),
    "tool.execute.before": createProjectContextToolGuard(),
    "tool.execute.after": createProjectContextToolOutputRedactor()
  };
}

export const ProjectContextOpenCodePlugin: OpenCodeV1PluginModuleLike = {
  id: "crewbee-project-context",
  server
};

export default ProjectContextOpenCodePlugin;
