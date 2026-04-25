import { DEFAULT_CONTEXT_DIR } from "../../core/constants.js";
import { buildMaintainerPrompt, PROJECT_CONTEXT_MAINTAINER_AGENT_ID } from "./maintainer-prompt.js";
import type { OpenCodeAgentConfig, OpenCodeConfigLike, PermissionAction, PermissionRule } from "./types.js";

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
      task: "deny"
    }
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
      if (mode === "primary" || mode === "all") denyMaintainerTask(agent);
    }

    config.agent = agents;
    patchWatcherIgnore(config);
  };
}
