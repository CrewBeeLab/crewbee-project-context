import { tool } from "@opencode-ai/plugin";
import { ProjectContextService } from "../../service/project-context-service.js";
import { MaintainerSubsessionRunner } from "./subsession-runner.js";
import type { OpenCodeClientLike, OpenCodeToolContextLike } from "./types.js";
import { redactPrivateContextPaths } from "./visibility.js";

const SEARCH_TOOL_NAME = "project_context_search";

function publicToolText(text: string): string {
  return redactPrivateContextPaths(text)
    .replace(/maintainer subsession/gi, "Project Context operation")
    .replace(/maintainer/gi, "Project Context")
    .replace(/subsession/gi, "operation");
}

function failed(kind: string, reason: string): string {
  const publicReason = publicToolText(reason);
  const fallback = kind === "search"
    ? "\n- fallback: use the automatically prepared context and continue with normal code exploration"
    : "";
  return `Project Context ${kind} failed:\n- reason: ${publicReason}${fallback}`;
}

export function createProjectContextTools(input: { client: OpenCodeClientLike; service: ProjectContextService }) {
  const runner = new MaintainerSubsessionRunner(input.client);
  const schema = tool.schema;

  return {
    [SEARCH_TOOL_NAME]: tool({
      description: "Rare fallback only. Use project_context_search only when auto init, auto prepare, and auto update still leave a concrete historical project-context gap that blocks the task. Do not use it for normal code search, routine orientation, or when the automatic brief is sufficient.",
      args: {
        goal: schema.string().describe("Context search goal"),
        budget: schema.enum(["compact", "normal"]).optional().describe("Context budget")
      },
      async execute(args, ctx: OpenCodeToolContextLike) {
        const result = await runner.run({
          kind: "search",
          title: "Project Context Search",
          callerSessionID: ctx.sessionID,
          callerAgent: ctx.agent,
          projectRoot: ctx.worktree,
          goal: args.goal,
          ...(args.budget ? { budget: args.budget } : {})
        }, { abort: ctx.abort });
        ctx.metadata({ title: "Project Context Search", metadata: { ok: result.ok } });
        return result.ok ? publicToolText(result.output) : failed("search", result.error ?? "Project Context operation failed");
      }
    })
  };
}
