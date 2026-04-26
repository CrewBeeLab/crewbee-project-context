import { ProjectContextService } from "../../service/project-context-service.js";
import { AutoUpdateManager } from "./auto-update-hook.js";
import { createProjectContextConfigHook } from "./config-hook.js";
import { createProjectContextSystemTransformHook } from "./system-transform-hook.js";
import { createProjectContextToolGuard } from "./tool-guard.js";
import { createProjectContextToolOutputRedactor } from "./tool-output-redactor.js";
import { createProjectContextTools } from "./tools.js";
import type { OpenCodePluginInputLike, OpenCodeV1PluginModuleLike } from "./types.js";

export async function server(ctx: OpenCodePluginInputLike) {
  const service = new ProjectContextService(ctx.worktree);
  const autoUpdate = new AutoUpdateManager({ client: ctx.client, service, projectRoot: ctx.worktree });
  const redactOutput = createProjectContextToolOutputRedactor();
  const guardTool = createProjectContextToolGuard({ client: ctx.client, projectRoot: ctx.worktree });
  return {
    config: createProjectContextConfigHook(),
    tool: createProjectContextTools({ client: ctx.client, service }),
    "experimental.chat.system.transform": createProjectContextSystemTransformHook({ service, client: ctx.client, projectRoot: ctx.worktree, onMaintainerSessionCreated: (sessionID) => autoUpdate.ignoreSession(sessionID) }),
    event: (input: { event: unknown }) => autoUpdate.handleEvent(input),
    "chat.message": (input: { sessionID?: string; agent?: string; model?: unknown }, output: { message?: unknown; parts?: unknown[] }) => autoUpdate.recordChatMessage(input, output),
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string; agent?: string; args?: unknown }, output: { args?: unknown }) => {
      await guardTool(input, output);
      autoUpdate.recordToolBefore(input, output);
    },
    "tool.execute.after": async (input: { tool: string; sessionID: string; callID: string; agent?: string; args?: unknown }, output: { result?: unknown; [key: string]: unknown }) => {
      autoUpdate.recordToolAfter(input);
      await redactOutput(input, output);
    }
  };
}

export const ProjectContextOpenCodePlugin: OpenCodeV1PluginModuleLike = {
  id: "crewbee-project-context",
  server
};

export default ProjectContextOpenCodePlugin;
