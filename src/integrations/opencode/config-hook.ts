import { DEFAULT_CONTEXT_DIR, PRIVATE_RUNTIME_CONTEXT_DIR } from "../../core/constants.js";
import { buildMaintainerPrompt, PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import type { OpenCodeAgentConfig, OpenCodeConfigLike, PermissionAction, PermissionRule } from "./types.js";

const PROJECT_CONTEXT_TOOL_NAMES = ["project_context_search"] as const;
const MAINTAINER_ALLOWED_TOOLS = {
  read: true,
  glob: true,
  grep: true,
  edit: true,
  write: true,
  patch: true,
  apply_patch: true,
  bash: true,
  webfetch: false,
  websearch: false,
  task: false,
  project_context_search: false,
  session: false,
  "session.create": false,
  "session.prompt": false,
  "session.promptAsync": false
} as const;

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
    description: "Internal project context maintainer. Invoked only by the Project Context runtime.",
    prompt: buildMaintainerPrompt(),
    permission: {
      read: { "*": "allow", "*.env": "deny", "*.env.*": "deny", [`${PRIVATE_RUNTIME_CONTEXT_DIR}/cache/update-jobs/**`]: "allow" },
      glob: "allow",
      grep: "allow",
      edit: { [`${DEFAULT_CONTEXT_DIR}/**`]: "allow", "*": "deny" },
      write: { [`${DEFAULT_CONTEXT_DIR}/**`]: "allow", "*": "deny" },
      patch: { [`${DEFAULT_CONTEXT_DIR}/**`]: "allow", "*": "deny" },
      apply_patch: { [`${DEFAULT_CONTEXT_DIR}/**`]: "allow", "*": "deny" },
      bash: { "git status": "allow", "git status *": "allow", "git diff": "allow", "git diff *": "allow", "git log": "allow", "git log *": "allow", "npm run doctor": "allow", "npm run doctor *": "allow", "*": "deny" },
      webfetch: "deny",
      websearch: "deny",
      task: "deny",
      project_context_search: "deny",
      session: "deny",
      "session.create": "deny",
      "session.prompt": "deny",
      "session.promptAsync": "deny"
    },
    tools: { ...MAINTAINER_ALLOWED_TOOLS }
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
  const additions = [`${DEFAULT_CONTEXT_DIR}/cache/**`, `${DEFAULT_CONTEXT_DIR}/tmp/**`, `${DEFAULT_CONTEXT_DIR}/*.lock`, `${PRIVATE_RUNTIME_CONTEXT_DIR}/cache/**`, `${PRIVATE_RUNTIME_CONTEXT_DIR}/tmp/**`, `${PRIVATE_RUNTIME_CONTEXT_DIR}/*.lock`];
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
