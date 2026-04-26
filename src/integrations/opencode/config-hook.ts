import { DEFAULT_CONTEXT_DIR } from "../../core/constants.js";
import { buildMaintainerPrompt, PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import type { OpenCodeAgentConfig, OpenCodeConfigLike, PermissionAction, PermissionRule } from "./types.js";

const PROJECT_CONTEXT_TOOL_NAMES = ["project_context_prepare", "project_context_search", "project_context_update", "project_context_finalize"] as const;

function denyProjectContextRuntimeAccess(permission: Record<string, PermissionRule | undefined>): void {
  for (const toolName of PROJECT_CONTEXT_TOOL_NAMES) permission[toolName] = "deny";
  // Defensive deny entries for runtimes that expose session operations as tools.
  permission.session = "deny";
  permission["session.create"] = "deny";
  permission["session.prompt"] = "deny";
  permission["session.promptAsync"] = "deny";
}

function disableProjectContextTools(tools: Record<string, boolean> | undefined): Record<string, boolean> {
  const next = { ...(tools ?? {}) };
  for (const toolName of PROJECT_CONTEXT_TOOL_NAMES) next[toolName] = false;
  return next;
}

function asRuleObject(rule: PermissionRule | undefined): Record<string, PermissionAction> {
  if (rule === "ask" || rule === "allow" || rule === "deny") return { "*": rule };
  return { ...(rule ?? {}) };
}

function createMaintainerAgent(): OpenCodeAgentConfig {
  return {
    mode: "subagent",
    hidden: true,
    description: "Internal project context maintainer. Invoked only by project_context_* tools.",
    prompt: buildMaintainerPrompt(),
    permission: {
      read: { "*": "allow", "*.env": "deny", "*.env.*": "deny" },
      glob: "allow",
      grep: "allow",
      edit: { "*": "deny", [`${DEFAULT_CONTEXT_DIR}/**`]: "allow" },
      bash: { "*": "deny", "git status *": "allow", "git diff *": "allow", "git log *": "allow" },
      webfetch: "deny",
      websearch: "deny",
      task: "deny",
      project_context_prepare: "deny",
      project_context_search: "deny",
      project_context_update: "deny",
      project_context_finalize: "deny",
      session: "deny",
      "session.create": "deny",
      "session.prompt": "deny",
      "session.promptAsync": "deny"
    },
    tools: disableProjectContextTools(undefined)
  };
}

function denyMaintainerTask(agent: OpenCodeAgentConfig): void {
  const permission = { ...(agent.permission ?? {}) };
  permission.task = {
    ...asRuleObject(permission.task),
    [PROJECT_CONTEXT_MAINTAINER_AGENT_ID]: "deny"
  };
  agent.permission = permission;
}

function denyProjectContextTools(agent: OpenCodeAgentConfig): void {
  const permission = { ...(agent.permission ?? {}) };
  denyProjectContextRuntimeAccess(permission);
  agent.permission = permission;
  agent.tools = disableProjectContextTools(agent.tools);
}

function patchWatcherIgnore(config: OpenCodeConfigLike): void {
  const watcher = config.watcher && typeof config.watcher === "object" && !Array.isArray(config.watcher)
    ? { ...(config.watcher as Record<string, unknown>) }
    : {};
  const existingIgnore = Array.isArray(watcher.ignore) ? watcher.ignore : [];
  const additions = [".crewbeectxt/cache/**", ".crewbeectxt/tmp/**", ".crewbeectxt/*.lock"];
  watcher.ignore = [...existingIgnore, ...additions.filter((entry) => !existingIgnore.includes(entry))];
  config.watcher = watcher;
}

export function createProjectContextConfigHook() {
  return async (config: OpenCodeConfigLike): Promise<void> => {
    const agents = { ...(config.agent ?? {}) };
    agents[PROJECT_CONTEXT_MAINTAINER_AGENT_ID] = {
      ...(agents[PROJECT_CONTEXT_MAINTAINER_AGENT_ID] ?? {}),
      ...createMaintainerAgent()
    };

    for (const [id, agent] of Object.entries(agents)) {
      if (id === PROJECT_CONTEXT_MAINTAINER_AGENT_ID) continue;
      const mode = agent.mode ?? "all";
      if (mode === "subagent") denyProjectContextTools(agent);
      if (mode === "primary" || mode === "all") denyMaintainerTask(agent);
    }

    config.agent = agents;
    patchWatcherIgnore(config);
  };
}
