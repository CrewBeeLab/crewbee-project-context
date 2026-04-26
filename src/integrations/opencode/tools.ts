import { tool } from "@opencode-ai/plugin";
import { ProjectContextService } from "../../service/project-context-service.js";
import { MaintainerSubsessionRunner } from "./subsession-runner.js";
import type { OpenCodeClientLike, OpenCodeToolContextLike } from "./types.js";
import { redactPrivateContextPaths } from "./visibility.js";

const PREPARE_TOOL_NAME = "project_context_prepare";
const SEARCH_TOOL_NAME = "project_context_search";
const UPDATE_TOOL_NAME = "project_context_update";
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

function updatePayload(goal: string, updateType: string | undefined, facts: string[] | undefined, evidence: string[] | undefined): Record<string, unknown> {
  return {
    goal,
    ...(updateType ? { update_type: updateType } : {}),
    ...(stringArray(facts) ? { facts } : {}),
    ...(stringArray(evidence) ? { evidence } : {})
  };
}

function publicToolText(text: string): string {
  return redactPrivateContextPaths(text)
    .replace(/maintainer subsession/gi, "Project Context operation")
    .replace(/maintainer/gi, "Project Context")
    .replace(/subsession/gi, "operation");
}

function failed(kind: string, reason: string): string {
  const publicReason = publicToolText(reason);
  const fallback = kind === "search"
    ? "\n- fallback: use project_context_prepare result and continue with code exploration"
    : "";
  const nextAction = kind === "finalize"
    ? "\n- workspace update is not guaranteed\n- next action: rerun project_context_finalize with the same summary"
    : kind === "update"
      ? "\n- workspace may need review"
      : "";
  return `Project Context ${kind} failed:\n- reason: ${publicReason}${fallback}${nextAction}`;
}

function preview(text: string, maxLength = 360): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function prepared(output: string): string {
  const redacted = publicToolText(output).trim();
  return [
    "Project Context Prepare completed:",
    "",
    "Summary:",
    `- ${preview(redacted)}`,
    "",
    "Prepared context:",
    redacted
  ].join("\n");
}

function updated(): string {
  return [
    "Project Context updated:",
    "- project context workspace maintained",
    "- high-signal context updated when applicable",
    "- consistency checks passed"
  ].join("\n");
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
        const brief = await input.service.prepareContext({
          goal: args.goal,
          ...(args.task_type ? { taskType: args.task_type } : {}),
          ...(args.budget ? { budget: args.budget } : {})
        });
        const output = prepared(brief.text);
        ctx.metadata({ title: "Project Context Prepare", metadata: { ok: true, estimatedTokens: brief.estimatedTokens, warnings: brief.warnings.length, preview: preview(output, 160) } });
        return output;
      }
    }),

    [SEARCH_TOOL_NAME]: tool({
      description: "Search prior project context by goal when prepared context is insufficient.",
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
    }),

    [UPDATE_TOOL_NAME]: tool({
      description: "Request explicit Project Context maintenance before final task handoff.",
      args: {
        goal: schema.string().describe("Context update goal"),
        update_type: schema.enum(["plan", "architecture", "implementation", "decision", "memory", "handoff", "general"]).optional().describe("Kind of context update"),
        facts: schema.array(schema.string()).optional().describe("Facts to preserve"),
        evidence: schema.array(schema.string()).optional().describe("Evidence supporting the update"),
        budget: schema.enum(["compact", "normal"]).optional().describe("Context budget")
      },
      async execute(args, ctx: OpenCodeToolContextLike) {
        const payload = updatePayload(args.goal, args.update_type, args.facts, args.evidence);
        const result = await runner.run({
          kind: "update",
          title: "Project Context Update",
          callerSessionID: ctx.sessionID,
          callerAgent: ctx.agent,
          projectRoot: ctx.worktree,
          goal: args.goal,
          ...(args.budget ? { budget: args.budget } : {}),
          payload
        }, { abort: ctx.abort });
        if (!result.ok) return failed("update", result.error ?? "Project Context operation failed");
        const validation = await input.service.validateContext();
        ctx.metadata({ title: "Project Context Update", metadata: { ok: validation.ok } });
        if (!validation.ok) return failed("update", "project context consistency check failed");
        return updated();
      }
    }),

    [FINALIZE_TOOL_NAME]: tool({
      description: "Finalize project context after material changes.",
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
        if (!result.ok) return failed("finalize", result.error ?? "Project Context operation failed");

        const validation = await input.service.validateContext();
        ctx.metadata({ title: "Project Context Finalize", metadata: { ok: validation.ok } });
        if (!validation.ok) return failed("finalize", "project context consistency check failed");
        return finalized();
      }
    })
  };
}
