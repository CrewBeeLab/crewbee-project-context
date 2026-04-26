import type { ToolDefinition } from "@opencode-ai/plugin";

export type PermissionAction = "ask" | "allow" | "deny";
export type PermissionRule = PermissionAction | Record<string, PermissionAction>;

export interface OpenCodeAgentConfig {
  mode?: "subagent" | "primary" | "all";
  hidden?: boolean;
  description?: string;
  prompt?: string;
  permission?: Record<string, PermissionRule | undefined>;
  tools?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface OpenCodeConfigLike {
  agent?: Record<string, OpenCodeAgentConfig>;
  [key: string]: unknown;
}

export interface OpenCodeToolContextLike {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void;
}

export interface OpenCodeClientLike {
  session: {
    create(input: { body: { parentID: string; title: string }; query?: { directory?: string; workspace?: string } }): Promise<unknown>;
    get?(input: { path: { id: string }; query?: { directory?: string; workspace?: string } }): Promise<unknown>;
    messages(input: { path: { id: string }; query?: { directory?: string; workspace?: string; limit?: number } }): Promise<unknown>;
    prompt?(input: { path: { id: string }; body: { agent?: string; tools?: Record<string, boolean>; parts: Array<{ type: "text"; text: string }> }; query?: { directory?: string; workspace?: string } }): Promise<unknown>;
    promptAsync?(input: { path: { id: string }; body: { agent?: string; tools?: Record<string, boolean>; parts: Array<{ type: "text"; text: string }> }; query?: { directory?: string; workspace?: string } }): Promise<unknown>;
    status?(input?: { query?: { directory?: string; workspace?: string } }): Promise<unknown>;
    abort?(input: { path: { id: string }; query?: { directory?: string; workspace?: string } }): Promise<unknown>;
  };
}

export interface OpenCodePluginInputLike {
  client: OpenCodeClientLike;
  worktree: string;
  directory: string;
}

export interface OpenCodeHooksLike {
  config?: (input: OpenCodeConfigLike) => Promise<void>;
  tool?: Record<string, ToolDefinition>;
  event?: (input: { event: unknown }) => Promise<void>;
  "experimental.chat.system.transform"?: (input: { sessionID?: string; model: unknown }, output: { system: string[] }) => Promise<void>;
  "tool.execute.before"?: (input: { tool: string; sessionID: string; callID: string; agent?: string; args?: unknown }, output: { args?: unknown }) => Promise<void>;
  "tool.execute.after"?: (input: { tool: string; sessionID: string; callID: string; agent?: string }, output: { result?: unknown }) => Promise<void>;
}

export interface OpenCodeV1PluginModuleLike {
  id: string;
  server(input: OpenCodePluginInputLike): Promise<OpenCodeHooksLike>;
}
