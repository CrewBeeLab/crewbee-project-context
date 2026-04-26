import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as publicApi from "../dist/src/index.js";
import { buildCrewBeePromptFragment, executeCrewBeeProjectContextTool, getCrewBeeToolNames, prepareProjectContext } from "../dist/src/index.js";
import { ProjectContextService } from "../dist/src/service/project-context-service.js";
import { hasRecommendedPluginOrder, runInstallDoctor, upsertProjectContextPluginEntry } from "../dist/src/install/index.js";
import { MaintainerSubsessionRunner } from "../dist/src/integrations/opencode/subsession-runner.js";
import { writeRuntimeLog } from "../dist/src/integrations/opencode/runtime-log.js";

const service = (root) => new ProjectContextService(root);

test("public package surface stays focused on CrewBee sidecar usage", () => {
  assert.equal("project_context_read" in publicApi, false);
  assert.equal("readContextFile" in publicApi, false);
  assert.equal("initProjectContext" in publicApi, false);
  assert.equal(typeof publicApi.executeCrewBeeProjectContextTool, "function");
});

test("init creates a valid .crewbeectxt workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    const init = await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    assert.ok(init.created.includes(".crewbeectxt/STATE.yaml"));
    const quickstart = await readFile(path.join(root, ".crewbeectxt", "QUICKSTART.md"), "utf8");
    assert.match(quickstart, /Demo Context Quickstart/);
    const validation = await service(root).validateContext();
    assert.equal(validation.ok, true, validation.errors.join("; "));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("primer includes project and active step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    const primer = await service(root).buildPrimer({ budgetTokens: 1000 });
    assert.match(primer.text, /Project Context: available/);
    assert.doesNotMatch(primer.text, /\.crewbeectxt/);
    assert.equal(primer.warnings.some((warning) => warning.includes(".crewbeectxt")), false);
    assert.match(primer.text, /Demo/);
    assert.match(primer.text, /S1/);
    assert.ok(primer.estimatedTokens <= 1000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search returns matching context files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    const result = await service(root).searchContext("project objective");
    assert.ok(result.items.length > 0);
    assert.ok(result.items.some((item) => item.source.endsWith("PROJECT.md")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepare returns a task context brief", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    const brief = await prepareProjectContext(root, "Implement minimal CrewBee Project Context integration.");
    assert.match(brief.text, /Project Context Brief/);
    assert.match(brief.text, /Project Context: available/);
    assert.doesNotMatch(brief.text, /\.crewbeectxt/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepare degrades quickly when project context is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    const brief = await prepareProjectContext(root, "Explore an uninitialized project.");
    assert.match(brief.text, /No persisted project context is available yet/);
    assert.doesNotMatch(brief.text, /STATE\.yaml|HANDOFF\.md|PLAN\.yaml|observations/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor rejects invalid active step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    await writeFile(path.join(root, ".crewbeectxt", "STATE.yaml"), "project_id: demo\nrun_status: running\nactive_cycle: C1\nactive_step_id: S999\nlast_checkpoint: CP-0001\nblockers: []\nnext_actions:\n  - action: Continue\n    owner: active-agent\n    source: PLAN.yaml\n", "utf8");
    const validation = await service(root).validateContext();
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.some((error) => error.includes("active_step_id 'S999'")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor rejects missing exact next actions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    await writeFile(path.join(root, ".crewbeectxt", "HANDOFF.md"), "# Session Handoff\n\n## Current Snapshot\n\n- Active step: C1/S1.\n", "utf8");
    const validation = await service(root).validateContext();
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.some((error) => error.includes("Exact Next Actions")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("service does not expose direct context file reads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    assert.equal("readContextFile" in service(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("CrewBee bridge stays minimal and disabled when context is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    const fragment = await buildCrewBeePromptFragment(root);
    assert.equal(fragment.enabled, false);
    assert.deepEqual(getCrewBeeToolNames(), ["project_context_search"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("CrewBee bridge exposes only search as a manual Project Context tool", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    const fragment = await buildCrewBeePromptFragment(root);
    assert.equal(fragment.enabled, true);
    assert.match(fragment.text, /Project Context: available/);
    assert.doesNotMatch(fragment.text, /\.crewbeectxt/);

    const search = await executeCrewBeeProjectContextTool(root, "project_context_search", { goal: "project objective" });
    assert.match(search.text, /Project Context Search Result/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode plugin auto-prepares context, exposes only search, and auto-updates on idle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    let promptAsyncCalls = 0;
    const client = {
      session: {
        async create() {
          return { id: "maintainer-session" };
        },
        async get(input) {
          assert.equal(input.query.directory, root);
          return input.path.id === "child-session" ? { id: "child-session", parentID: "parent-session" } : { id: input.path.id };
        },
        async promptAsync(input) {
          promptAsyncCalls += 1;
          assert.equal(input.body.tools.project_context_search, false);
          return {};
        },
        async status() {
          return { "maintainer-session": { type: "idle" } };
        },
        async messages() {
          return [{ role: "assistant", parts: [{ type: "text", text: "Maintainer result from .crewbeectxt/HANDOFF.md" }] }];
        }
      }
    };
    const hooks = await publicApi.ProjectContextOpenCodePlugin.server({ client, worktree: root, directory: root });
    assert.equal("experimental.session.compacting" in hooks, false);
    assert.deepEqual(Object.keys(hooks.tool).sort(), ["project_context_search"]);

    const config = { agent: { "coding-leader": { mode: "primary", permission: {} }, "worker": { mode: "subagent", permission: {} } } };
    await hooks.config(config);
    assert.equal(config.agent["project-context-maintainer"].hidden, true);
    assert.equal(config.agent["project-context-maintainer"].mode, "subagent");
    assert.equal(config.agent["project-context-maintainer"].permission.project_context_search, "deny");
    assert.equal(config.agent["project-context-maintainer"].permission["session.prompt"], "deny");
    assert.equal(config.agent["project-context-maintainer"].tools.project_context_search, false);
    assert.equal(config.agent["coding-leader"].permission.task["project-context-maintainer"], "deny");
    assert.equal(config.agent.worker.permission.project_context_search, "deny");
    assert.equal(config.agent.worker.tools.project_context_search, false);
    assert.ok(config.watcher.ignore.includes(".crewbeectxt/cache/**"));

    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "c" }, { args: { subagent_type: "project-context-maintainer" } }), /Do not invoke/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "project_context_search", sessionID: "child-session", callID: "c", agent: "worker" }, { args: { goal: "x" } }), /root primary-agent sessions/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "project_context_search", sessionID: "maintainer-session", callID: "c", agent: "project-context-maintainer" }, { args: { goal: "x" } }), /must not call project_context/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c", agent: "coding-leader" }, { args: { filePath: ".crewbeectxt/HANDOFF.md" } }), /Project Context workspace is private/);
    await hooks["tool.execute.before"]({ tool: "grep", sessionID: "s", callID: "grep", agent: "coding-leader" }, { args: { pattern: [".", "crewbeectxt"].join(""), include: "*.md" } });
    await hooks["tool.execute.before"]({ tool: "apply_patch", sessionID: "s", callID: "patch", agent: "coding-leader" }, { args: { patchText: `Docs mention ${[".", "crewbeectxt"].join("")} without reading it.` } });
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c", agent: "project-context-maintainer" }, { args: { filePath: ".crewbeectxt/HANDOFF.md" } });
    const redacted = { result: { ".crewbeectxt/HANDOFF.md": "listed .crewbeectxt/HANDOFF.md and src/index.ts" } };
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "c", agent: "coding-leader", args: { command: "npm test" } }, redacted);
    assert.deepEqual(redacted.result, { "[project-context-private]": "listed [project-context-private] and src/index.ts" });

    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    const rootSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, rootSystem);
    assert.equal(rootSystem.system.length, 1);
    assert.match(rootSystem.system[0], /Project Context is prepared automatically/);
    assert.match(rootSystem.system[0], /Project Context Brief/);
    assert.doesNotMatch(rootSystem.system[0], /.crewbeectxt|STATE\.yaml|HANDOFF\.md|PLAN\.yaml|observations/);
    const followupSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, followupSystem);
    assert.equal(followupSystem.system.length, 1);
    assert.doesNotMatch(followupSystem.system[0], /Project Context Brief/);
    await writeFile(path.join(root, [".", "crewbeectxt"].join(""), "HANDOFF.md"), "# Handoff\n\nRevision changed.\n", "utf8");
    const revisionSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, revisionSystem);
    assert.equal(revisionSystem.system.length, 1);
    assert.match(revisionSystem.system[0], /Project Context Brief/);
    const childSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "child-session", model: {} }, childSystem);
    assert.equal(childSystem.system.length, 0);

    const searchOutput = await hooks.tool.project_context_search.execute({ goal: "project objective" }, {
      sessionID: "parent-session",
      messageID: "message",
      agent: "coding-leader",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {}
    });
    assert.doesNotMatch(searchOutput, /.crewbeectxt/);
    assert.equal(promptAsyncCalls, 1);

    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "parent-session", callID: "test", agent: "coding-leader" }, { args: { command: "npm test" } });
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "parent-session", callID: "test", agent: "coding-leader" }, { result: "ok" });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(promptAsyncCalls, 2);

    await hooks.event({ event: { type: "message.updated", properties: { sessionID: "maintainer-session", info: { role: "assistant" }, parts: [{ type: "text", text: "决定更新内部上下文。" }] } } });
    await hooks.event({ event: { type: "session.status", properties: { sessionID: "maintainer-session", status: { type: "idle" } } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(promptAsyncCalls, 2);

    await hooks.event({ event: { type: "message.updated", properties: { sessionID: "parent-session", info: { role: "assistant" }, parts: [{ type: "text", text: "决定采用 auto update，下一步补充验证。" }] } } });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(promptAsyncCalls, 3);

    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, { message: { info: { role: "user" } }, parts: [{ type: "text", text: "请更新上下文。" }] });
    await hooks.event({ event: { type: "session.status", properties: { info: { id: "parent-session" }, status: { type: "idle" } } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(promptAsyncCalls, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode plugin auto-initializes missing scaffold on first root session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-autoinit-"));
  try {
    let createCalls = 0;
    let promptAsyncCalls = 0;
    const client = {
      session: {
        async create(input) {
          createCalls += 1;
          assert.equal(input.body.parentID, "parent-session");
          return { id: "init-maintainer-session" };
        },
        async get(input) {
          return { id: input.path.id };
        },
        async promptAsync(input) {
          promptAsyncCalls += 1;
          assert.equal(input.path.id, "init-maintainer-session");
          assert.equal(input.body.agent, "project-context-maintainer");
          assert.match(input.body.parts[0].text, /Project Context Maintainer job: initialize/);
          assert.match(input.body.parts[0].text, /Read the project documentation, architecture\/design notes/);
          return {};
        },
        async status() {
          return { "init-maintainer-session": { type: "idle" } };
        },
        async messages() {
          return [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Initialized project context." }] }];
        }
      }
    };

    const hooks = await publicApi.ProjectContextOpenCodePlugin.server({ client, worktree: root, directory: root });
    const output = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, output);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(output.system.length, 1);
    assert.match(output.system[0], /Project Context Brief/);
    assert.equal(createCalls, 1);
    assert.equal(promptAsyncCalls, 1);
    const validation = await service(root).validateContext();
    assert.equal(validation.ok, true, validation.errors.join("; "));

    await hooks.event({ event: { type: "session.status", properties: { sessionID: "init-maintainer-session", status: { type: "idle" } } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(promptAsyncCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled OpenCode server entrypoint matches package plugin shape", async () => {
  const rootMod = await import(`../opencode-plugin.mjs?test=${Date.now()}`);
  const mod = await import("../dist/opencode-plugin.mjs");
  assert.equal(typeof rootMod.default.server, "function");
  assert.equal(typeof rootMod.server, "function");
  assert.equal(typeof mod.default.server, "function");
  assert.equal(typeof mod.server, "function");
});

test("maintainer subsession runner completes via prompt_async polling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-runner-"));
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "crewbee-opencode-data-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  const calls = [];
  const client = {
    session: {
      async create(input) {
        calls.push(["create", input.query]);
        return { id: "maintainer-session" };
      },
      async promptAsync(input) {
        calls.push(["promptAsync", input.path.id, input.query]);
        assert.equal(input.body.tools.project_context_search, false);
        return undefined;
      },
      async status() {
        calls.push(["status"]);
        return { "maintainer-session": { type: "idle" } };
      },
      async messages() {
        calls.push(["messages"]);
        return [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Maintainer completed." }] }];
      }
    }
  };
  try {
    process.env.XDG_DATA_HOME = dataHome;
    const runner = new MaintainerSubsessionRunner(client);
    const result = await runner.run({
      kind: "search",
      title: "Project Context Search",
      callerSessionID: "parent-session",
      callerAgent: "coding-leader",
      projectRoot: root,
      goal: "Prepare context."
    }, { timeoutMs: 1000, pollIntervalMs: 1 });

    assert.equal(result.ok, true);
    assert.equal(result.output, "Maintainer completed.");
    assert.ok(calls.some((call) => call[0] === "promptAsync"));
    const parentLogText = await readFile(path.join(dataHome, "opencode", "log", "crewbee", "crewbee-project-context-parent-session.log"), "utf8");
    const logText = await readFile(path.join(dataHome, "opencode", "log", "crewbee", "crewbee-project-context-maintainer-session.log"), "utf8");
    assert.match(parentLogText, /maintainer-runner start/);
    assert.match(logText, /maintainer-runner poll/);
    assert.match(logText, /maintainer-runner completed/);
    assert.doesNotMatch(logText, /^\{/m);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    await rm(root, { recursive: true, force: true });
    await rm(dataHome, { recursive: true, force: true });
  }
});

test("maintainer subsession runner times out and aborts stuck prompt_async jobs", async () => {
  let abortCalled = false;
  const client = {
    session: {
      async create() {
        return { id: "maintainer-session" };
      },
      async promptAsync() {
        return undefined;
      },
      async status() {
        return { "maintainer-session": { type: "busy" } };
      },
      async messages() {
        return [];
      },
      async abort(input) {
        abortCalled = input.path.id === "maintainer-session";
        return true;
      }
    }
  };
  const runner = new MaintainerSubsessionRunner(client);
  const result = await runner.run({
    kind: "search",
    title: "Project Context Search",
    callerSessionID: "parent-session",
    callerAgent: "coding-leader",
    projectRoot: process.cwd(),
    goal: "Prepare context."
  }, { timeoutMs: 20, pollIntervalMs: 1 });

  assert.equal(result.ok, false);
  assert.match(result.error, /did not complete/);
  assert.equal(abortCalled, true);
});

test("maintainer subsession runner refuses blocking prompt fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-runner-"));
  let promptCalled = false;
  const client = {
    session: {
      async create() {
        return { id: "maintainer-session" };
      },
      async prompt() {
        promptCalled = true;
        return undefined;
      },
      async messages() {
        return [];
      }
    }
  };
  try {
    const runner = new MaintainerSubsessionRunner(client);
    const result = await runner.run({
      kind: "search",
      title: "Project Context Search",
      callerSessionID: "parent-session",
      callerAgent: "coding-leader",
      projectRoot: root,
      goal: "Prepare context."
    }, { timeoutMs: 1000, pollIntervalMs: 1 });

    assert.equal(result.ok, false);
    assert.match(result.error, /promptAsync/);
    assert.equal(promptCalled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime log uses OpenCode log directory and text lines", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "crewbee-opencode-data-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  try {
    process.env.XDG_DATA_HOME = dataHome;
    await writeRuntimeLog(root, { component: "tool-guard", event: "allow-project-context-tool", sessionID: "s", agent: "coding-leader", tool: "project_context_search" });
    const logText = await readFile(path.join(dataHome, "opencode", "log", "crewbee", "crewbee-project-context-s.log"), "utf8");
    assert.match(logText, /tool-guard allow-project-context-tool session=s agent=coding-leader tool=project_context_search/);
    assert.doesNotMatch(logText, /^\{/m);
    await assert.rejects(() => readFile(path.join(dataHome, "opencode", "log", "crewbee-project-context.log"), "utf8"));
    await assert.rejects(() => readFile(path.join(root, ".local", "crewbee-project-context", "runtime.jsonl"), "utf8"));
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    await rm(root, { recursive: true, force: true });
    await rm(dataHome, { recursive: true, force: true });
  }
});

test("install config writer keeps project context after CrewBee", () => {
  const config = { plugin: ["crewbee-project-context", "crewbee"] };
  const update = upsertProjectContextPluginEntry(config);
  assert.equal(update.changed, true);
  assert.deepEqual(config.plugin, ["crewbee", "crewbee-project-context"]);
  assert.equal(hasRecommendedPluginOrder(config), true);
});

test("install doctor verifies plugin entry, order, hidden maintainer, and tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-install-"));
  try {
    const installRoot = path.join(root, "install-root");
    const configPath = path.join(root, "config", "opencode.json");
    const installedPackageRoot = path.join(installRoot, "node_modules", "crewbee-project-context");
    await mkdir(installedPackageRoot, { recursive: true });
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(path.join(installRoot, "package.json"), JSON.stringify({ name: "opencode-plugin-workspace", private: true }, null, 2), "utf8");
    await writeFile(path.join(installedPackageRoot, "package.json"), JSON.stringify({ name: "crewbee-project-context", version: "0.1.0", type: "module" }, null, 2), "utf8");
    await writeFile(configPath, JSON.stringify({ plugin: ["crewbee", "crewbee-project-context"] }, null, 2), "utf8");
    await cp(path.resolve("dist"), path.join(installedPackageRoot, "dist"), { recursive: true });
    await cp(path.resolve("opencode-plugin.mjs"), path.join(installedPackageRoot, "opencode-plugin.mjs"));
    await cp(path.resolve("node_modules", "@opencode-ai", "plugin"), path.join(installRoot, "node_modules", "@opencode-ai", "plugin"), { recursive: true });
    await cp(path.resolve("node_modules", "zod"), path.join(installRoot, "node_modules", "zod"), { recursive: true });

    const result = await runInstallDoctor({ installRoot, configPath });
    assert.equal(result.healthy, true, JSON.stringify(result, null, 2));
    assert.equal(result.hasRecommendedPluginOrder, true);
    assert.equal(result.hasHiddenMaintainerAgent, true);
    assert.equal(result.hasSearchToolSurface, true);
    assert.equal(result.noProjectContextReadTool, true);
    assert.equal(result.noCompactionHook, true);
    assert.equal(result.maintainerTaskDeniedForPrimaryAgent, true);
    assert.equal(result.hasToolPrivatePathGuard, true);
    assert.equal(result.hasToolOutputRedactor, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
