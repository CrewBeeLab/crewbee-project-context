import type { OpenCodeClientLike, OpenCodePromptPartLike } from "./types.js";

type UnknownAsyncMethod = (input?: unknown, options?: unknown) => Promise<unknown>;

interface SessionMethod {
  call: UnknownAsyncMethod;
  arity: number;
}

interface SessionQueryInput {
  directory?: string;
  workspace?: string;
  limit?: number;
}

interface SessionPromptBodyInput {
  agent?: string;
  tools?: Record<string, boolean>;
  noReply?: boolean;
  parts: OpenCodePromptPartLike[];
}

function sessionMethod(client: OpenCodeClientLike, name: string): SessionMethod | undefined {
  const session = client.session as unknown as Record<string, unknown>;
  const method = session[name];
  if (typeof method !== "function") return undefined;
  return {
    arity: method.length,
    call: async (input?: unknown, options?: unknown) => Promise.resolve(Reflect.apply(method, session, options === undefined ? [input] : [input, options]) as unknown)
  };
}

function legacyQuery(query: SessionQueryInput | undefined): Record<string, unknown> | undefined {
  if (!query?.directory && query?.limit === undefined) return undefined;
  return {
    ...(query.directory ? { directory: query.directory } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {})
  };
}

function flatQuery(query: SessionQueryInput | undefined): Record<string, unknown> {
  return {
    ...(query?.directory ? { directory: query.directory } : {}),
    ...(query?.workspace ? { workspace: query.workspace } : {}),
    ...(query?.limit !== undefined ? { limit: query.limit } : {})
  };
}

function errorText(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, "error") || record.error === undefined || record.error === null) return undefined;
  if (typeof record.error === "string") return record.error;
  try {
    return JSON.stringify(record.error);
  } catch {
    return String(record.error);
  }
}

async function firstSuccessful(label: string, calls: (() => Promise<unknown>)[]): Promise<unknown> {
  const errors: string[] = [];
  for (const call of calls) {
    try {
      const result = await call();
      const error = errorText(result);
      if (!error) return result;
      errors.push(error);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`${label} failed: ${errors.join(" | ") || "no compatible OpenCode client method"}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAcceptedPromptStreamError(error: unknown): boolean {
  return /JSON Parse error:\s*Unexpected EOF/i.test(errorMessage(error));
}

async function firstSuccessfulPrompt(label: string, calls: (() => Promise<unknown>)[]): Promise<unknown> {
  const errors: string[] = [];
  for (const call of calls) {
    try {
      const result = await call();
      const error = errorText(result);
      if (!error) return result;
      errors.push(error);
    } catch (error) {
      if (isAcceptedPromptStreamError(error)) return undefined;
      errors.push(errorMessage(error));
    }
  }
  throw new Error(`${label} failed: ${errors.join(" | ") || "no compatible OpenCode client method"}`);
}

function compatibleCalls(method: SessionMethod, legacy: () => Promise<unknown>, flat: () => Promise<unknown>): (() => Promise<unknown>)[] {
  return method.arity >= 2 ? [flat, legacy] : [legacy, flat];
}

export function hasSessionMethod(client: OpenCodeClientLike, name: string): boolean {
  return sessionMethod(client, name) !== undefined;
}

export async function sessionGet(client: OpenCodeClientLike, input: { sessionID: string; query?: SessionQueryInput }): Promise<unknown> {
  const method = sessionMethod(client, "get");
  if (!method) throw new Error("OpenCode client does not expose session.get.");
  return firstSuccessful("OpenCode session.get", compatibleCalls(method,
    () => method.call({ path: { id: input.sessionID }, query: legacyQuery(input.query) }),
    () => method.call({ sessionID: input.sessionID, ...flatQuery(input.query) })
  ));
}

export async function sessionMessages(client: OpenCodeClientLike, input: { sessionID: string; query?: SessionQueryInput }): Promise<unknown> {
  const method = sessionMethod(client, "messages");
  if (!method) throw new Error("OpenCode client does not expose session.messages.");
  return firstSuccessful("OpenCode session.messages", compatibleCalls(method,
    () => method.call({ path: { id: input.sessionID }, query: legacyQuery(input.query) }),
    () => method.call({ sessionID: input.sessionID, ...flatQuery(input.query) })
  ));
}

export async function sessionStatus(client: OpenCodeClientLike, input: { query?: SessionQueryInput } = {}): Promise<unknown> {
  const method = sessionMethod(client, "status");
  if (!method) throw new Error("OpenCode client does not expose session.status.");
  return firstSuccessful("OpenCode session.status", compatibleCalls(method,
    () => method.call({ query: legacyQuery(input.query) }),
    () => method.call(flatQuery(input.query))
  ));
}

export async function sessionCreate(client: OpenCodeClientLike, input: { parentID: string; title: string; query?: SessionQueryInput }): Promise<unknown> {
  const method = sessionMethod(client, "create");
  if (!method) throw new Error("OpenCode client does not expose session.create.");
  return firstSuccessful("OpenCode session.create", compatibleCalls(method,
    () => method.call({ body: { parentID: input.parentID, title: input.title }, query: legacyQuery(input.query) }),
    () => method.call({ parentID: input.parentID, title: input.title, ...flatQuery(input.query) })
  ));
}

export async function sessionPrompt(client: OpenCodeClientLike, input: { sessionID: string; body: SessionPromptBodyInput; query?: SessionQueryInput }): Promise<unknown> {
  const method = sessionMethod(client, "prompt");
  if (!method) throw new Error("OpenCode client does not expose session.prompt.");
  return firstSuccessfulPrompt("OpenCode session.prompt", compatibleCalls(method,
    () => method.call({ path: { id: input.sessionID }, body: input.body, query: legacyQuery(input.query) }),
    () => method.call({ sessionID: input.sessionID, ...input.body, ...flatQuery(input.query) })
  ));
}

export async function sessionPromptAsync(client: OpenCodeClientLike, input: { sessionID: string; body: SessionPromptBodyInput; query?: SessionQueryInput }): Promise<unknown> {
  const method = sessionMethod(client, "promptAsync");
  if (!method) throw new Error("OpenCode client does not expose session.promptAsync.");
  return firstSuccessful("OpenCode session.promptAsync", compatibleCalls(method,
    () => method.call({ path: { id: input.sessionID }, body: input.body, query: legacyQuery(input.query) }),
    () => method.call({ sessionID: input.sessionID, ...input.body, ...flatQuery(input.query) })
  ));
}

export async function sessionAbort(client: OpenCodeClientLike, input: { sessionID: string; query?: SessionQueryInput }): Promise<unknown> {
  const method = sessionMethod(client, "abort");
  if (!method) throw new Error("OpenCode client does not expose session.abort.");
  return firstSuccessful("OpenCode session.abort", compatibleCalls(method,
    () => method.call({ path: { id: input.sessionID }, query: legacyQuery(input.query) }),
    () => method.call({ sessionID: input.sessionID, ...flatQuery(input.query) })
  ));
}
