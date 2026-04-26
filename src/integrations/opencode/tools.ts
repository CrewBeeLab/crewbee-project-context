import { tool } from "@opencode-ai/plugin";
import { ProjectContextService } from "../../service/project-context-service.js";
import { MaintainerSubsessionRunner } from "./subsession-runner.js";
import type { OpenCodeClientLike, OpenCodeToolContextLike } from "./types.js";
import { redactPrivateContextPaths } from "./visibility.js";

const PREPARE_TOOL_NAME = "project_context_prepare";
const SEARCH_TOOL_NAME = "project_context_search";
const FINALIZE_TOOL_NAME = "project_context_finalize";

function stringArray(value: string[] | undefined): string[] | undefined {
  return value && value.length > 0 ? value : undefined;
}

function materialPayload(summary: string | undefined, changedFiles: string[] | undefined, verification: string[] | undefined, blockers: string[] | undefined, nextActions: string[] | undefined): Record<string, unknown> {
  return {
    ...(summary ? { summary } : {}),
    ...(stringArray(changedFiles) ? { changed_files: changedFiles } : {}),
    ...(stringArray(verification) ? { verification } : {}),
    ...(stringArray(blockers) ? { blockers } : {}),
    ...(stringArray(nextActions) ? { next_actions: nextActions } : {})
  };
}

function failed(kind: string, reason: string): string {
  return `Project Context ${kind} failed:\n- reason: ${redactPrivateContextPaths(reason)}`;
}

function finalized(): string {
  return [
    "Project Context finalized:",
    "- project state updated",
    "- next-session handoff updated",
    "- high-signal memory updated when applicable",
    "- session observation recorded",
    "- consistency checks passed"
  ].join("\n");
}

export function createProjectContextTools(input: { client: OpenCodeClientLike; service: ProjectContextService }) {
  const runner = new MaintainerSubsessionRunner(input.client);
  const schema = tool.schema;

  return {
    [PREPARE_TOOL_NAME]: tool({
      description: "Prepare compact task-relevant project context without exposing scaffold files.",
      args: {
        goal: schema.string().describe("Current task goal"),
        task_type: schema.string().optional().describe("Task type, such as coding, research, planning, or review"),
        budget: schema.enum(["compact", "normal"]).optional().describe("Context budget")
      },
      async execute(args, ctx: OpenCodeToolContextLike) {
        const result = await runner.run({
          kind: "prepare",
          title: "Project Context Prepare",
          callerSessionID: ctx.sessionID,
          callerAgent: ctx.agent,
          projectRoot: ctx.worktree,
          goal: args.goal,
          ...(args.task_type ? { taskType: args.task_type } : {}),
          ...(args.budget ? { budget: args.budget } : {})
        }, { abort: ctx.abort });
        ctx.metadata({ title: "Project Context Prepare", metadata: { ok: result.ok } });
        return result.ok ? redactPrivateContextPaths(result.output) : failed("prepare", result.error ?? "maintainer subsession failed");
      }
    }),

    [SEARCH_TOOL_NAME]: tool({
      description: "Ask the internal maintainer to search project context by goal.",
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
        return result.ok ? redactPrivateContextPaths(result.output) : failed("search", result.error ?? "maintainer subsession failed");
      }
    }),

    [FINALIZE_TOOL_NAME]: tool({
      description: "Request internal project context maintenance after material changes.",
      args: {
        summary: schema.string().optional().describe("What changed or what was learned"),
        changed_files: schema.array(schema.string()).optional().describe("Changed files"),
        verification: schema.array(schema.string()).optional().describe("Verification evidence"),
        blockers: schema.array(schema.string()).optional().describe("Known blockers"),
        next_actions: schema.array(schema.string()).optional().describe("Suggested next actions")
      },
      async execute(args, ctx: OpenCodeToolContextLike) {
        const payload = materialPayload(args.summary, args.changed_files, args.verification, args.blockers, args.next_actions);
        const result = await runner.run({
          kind: "finalize",
          title: "Project Context Finalize",
          callerSessionID: ctx.sessionID,
          callerAgent: ctx.agent,
          projectRoot: ctx.worktree,
          payload
        }, { abort: ctx.abort });
        if (!result.ok) return failed("finalize", result.error ?? "maintainer subsession failed");

        const validation = await input.service.validateContext();
        ctx.metadata({ title: "Project Context Finalize", metadata: { ok: validation.ok } });
        if (!validation.ok) return failed("finalize", "project context consistency check failed");
        return finalized();
      }
    })
  };
}
