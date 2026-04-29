import path from "node:path";
import { ProjectContextService } from "../../service/project-context-service.js";
import { AutoUpdateManager } from "./auto-update-hook.js";
import { createProjectContextConfigHook } from "./config-hook.js";
import { createProjectContextSystemTransformHook } from "./system-transform-hook.js";
import { createProjectContextToolGuard } from "./tool-guard.js";
import { createProjectContextToolOutputRedactor } from "./tool-output-redactor.js";
import { createProjectContextTools } from "./tools.js";
import type { OpenCodePluginInputLike, OpenCodeV1PluginModuleLike } from "./types.js";
import { startBackgroundReleaseRefresh } from "../../update/refresh.js";

function projectRoot(input: OpenCodePluginInputLike): string {
  const worktreeRoot = path.parse(input.worktree).root;
  return path.resolve(input.worktree).toLowerCase() === path.resolve(worktreeRoot).toLowerCase()
    ? input.directory
    : input.worktree;
}

export async function server(ctx: OpenCodePluginInputLike) {
  const root = projectRoot(ctx);
  startBackgroundReleaseRefresh(ctx, root);
  const service = new ProjectContextService(root);
  const autoPrepare = createProjectContextSystemTransformHook({ service, client: ctx.client, projectRoot: root });
  const autoUpdate = new AutoUpdateManager({ client: ctx.client, service, projectRoot: root });
  const redactOutput = createProjectContextToolOutputRedactor();
  const guardTool = createProjectContextToolGuard({
    client: ctx.client,
    projectRoot: root,
    isRuntimeUpdateTask: (sessionID, args) => autoUpdate.isRuntimeUpdateTask(sessionID, args),
    isActiveUpdateJob: (sessionID, jobID) => autoUpdate.isActiveUpdateJob(sessionID, jobID),
    isMaintainerSession: (sessionID) => autoUpdate.isMaintainerSession(sessionID),
    markMaintainerSession: (sessionID) => autoUpdate.ignoreSession(sessionID),
    markRuntimeUpdateMaintainerSession: (input) => autoUpdate.markRuntimeUpdateMaintainerSession(input)
  });
  return {
    config: createProjectContextConfigHook(),
    tool: createProjectContextTools({ client: ctx.client, service }),
    "experimental.chat.system.transform": autoPrepare,
    event: async (input: { event: unknown }) => {
      await autoPrepare.handleEvent(input);
      await autoUpdate.handleEvent(input);
    },
    "chat.message": async (input: { sessionID?: string; agent?: string; model?: unknown }, output: { message?: unknown; parts?: unknown[] }) => {
      await autoPrepare.visibleChatMessage(input, output);
      await autoUpdate.recordChatMessage(input, output);
    },
    "experimental.chat.messages.transform": async (input: { sessionID?: string; agent?: string; model?: unknown }, output: { messages: { info?: unknown; parts?: unknown[] }[] }) => {
      if ((input.sessionID && autoUpdate.isMaintainerSession(input.sessionID)) || input.agent === "project-context-maintainer") return;
      autoPrepare.transformMessages(input, output);
    },
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string; agent?: string; args?: unknown }, output: { args?: unknown }) => {
      await guardTool(input, output);
      autoUpdate.recordToolBefore(input, output);
    },
    "tool.execute.after": async (input: { tool: string; sessionID: string; callID: string; agent?: string; args?: unknown }, output: { result?: unknown; [key: string]: unknown }) => {
      autoUpdate.filterRuntimeUpdateTaskResult(input, output);
      await autoUpdate.recordToolAfter(input, output);
      await redactOutput(input, output);
    }
  };
}

export const ProjectContextOpenCodePlugin: OpenCodeV1PluginModuleLike = {
  id: "crewbee-project-context",
  server
};

export default ProjectContextOpenCodePlugin;
