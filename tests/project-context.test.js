import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as publicApi from "../dist/src/index.js";
import { buildCrewBeePromptFragment, executeCrewBeeProjectContextTool, getCrewBeeToolNames, prepareProjectContext } from "../dist/src/index.js";
import { ProjectContextService } from "../dist/src/service/project-context-service.js";
import { hasRecommendedPluginOrder, runInstallDoctor, upsertProjectContextPluginEntry } from "../dist/src/install/index.js";
import { sessionAbort, sessionCreate, sessionGet, sessionMessages, sessionPrompt, sessionPromptAsync, sessionStatus } from "../dist/src/integrations/opencode/client-adapter.js";
import { MaintainerSubsessionRunner } from "../dist/src/integrations/opencode/subsession-runner.js";
import { writeRuntimeLog } from "../dist/src/integrations/opencode/runtime-log.js";

const service = (root) => new ProjectContextService(root);

async function populateTemplateContext(root) {
  const contextDir = path.join(root, ".crewbee", ".prjctxt");
  await writeFile(path.join(contextDir, "PROJECT.md"), "# Project\n\n## Project ID\n\ndemo\n\n## Project Name\n\nDemo\n\n## Objective\n\nMaintain project context reliably.\n", "utf8");
  await writeFile(path.join(contextDir, "ARCHITECTURE.md"), "# Architecture\n\n## System Map\n\nRuntime plugin, private scaffold, and hidden maintainer.\n", "utf8");
  await writeFile(path.join(contextDir, "IMPLEMENTATION.md"), "# Implementation Snapshot\n\n## What Works\n\nAutomatic prepare and update are implemented.\n\n## Verification Commands\n\nnpm test\n", "utf8");
  await writeFile(path.join(contextDir, "HANDOFF.md"), "# Session Handoff\n\n## Current Snapshot\n\n- Active step: C1/S1.\n\n## Exact Next Actions\n\n1. Continue validating Project Context integration.\n", "utf8");
}

async function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(await predicate(), true);
}

async function rmForceRetry(target, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

test("public package surface stays focused on CrewBee sidecar usage", () => {
  assert.equal("project_context_read" in publicApi, false);
  assert.equal("readContextFile" in publicApi, false);
  assert.equal("initProjectContext" in publicApi, false);
  assert.equal(typeof publicApi.executeCrewBeeProjectContextTool, "function");
});

test("init creates a valid .crewbee/.prjctxt workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    const init = await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    assert.ok(init.created.includes(".crewbee/.prjctxt/STATE.yaml"));
    const quickstart = await readFile(path.join(root, ".crewbee", ".prjctxt", "QUICKSTART.md"), "utf8");
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
    assert.doesNotMatch(primer.text, /\.crewbee\/\.prjctxt|\.crewbeectxt/);
    assert.equal(primer.warnings.some((warning) => /\.crewbee\/\.prjctxt|\.crewbeectxt/.test(warning)), false);
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
    assert.doesNotMatch(brief.text, /\.crewbee\/\.prjctxt|\.crewbeectxt/);
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
    await writeFile(path.join(root, ".crewbee", ".prjctxt", "STATE.yaml"), "project_id: demo\nrun_status: running\nactive_cycle: C1\nactive_step_id: S999\nlast_checkpoint: CP-0001\nblockers: []\nnext_actions:\n  - action: Continue\n    owner: active-agent\n    source: PLAN.yaml\n", "utf8");
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
    await writeFile(path.join(root, ".crewbee", ".prjctxt", "HANDOFF.md"), "# Session Handoff\n\n## Current Snapshot\n\n- Active step: C1/S1.\n", "utf8");
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
    assert.doesNotMatch(fragment.text, /\.crewbee\/\.prjctxt|\.crewbeectxt/);

    const search = await executeCrewBeeProjectContextTool(root, "project_context_search", { goal: "project objective" });
    assert.match(search.text, /Project Context Search Result/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode session client adapter supports v1 nested and v2 flat SDK shapes", async () => {
  const v1Calls = [];
  const v1Client = {
    session: {
      marker: "v1-session",
      async create(input) {
        assert.equal(this.marker, "v1-session");
        v1Calls.push(["create", input]);
        assert.equal(input.body.parentID, "parent-session");
        assert.equal(input.query.directory, "root-dir");
        return { data: { id: "child-session" } };
      },
      async get(input) {
        assert.equal(this.marker, "v1-session");
        v1Calls.push(["get", input]);
        assert.equal(input.path.id, "parent-session");
        assert.equal(input.query.directory, "root-dir");
        return { data: { id: input.path.id } };
      },
      async messages(input) {
        assert.equal(this.marker, "v1-session");
        v1Calls.push(["messages", input]);
        assert.equal(input.path.id, "parent-session");
        assert.equal(input.query.limit, 3);
        return { data: [{ info: { role: "assistant" }, parts: [] }] };
      },
      async prompt(input) {
        assert.equal(this.marker, "v1-session");
        v1Calls.push(["prompt", input]);
        assert.equal(input.path.id, "parent-session");
        assert.equal(input.body.parts[0].text, "hello");
        return { data: { info: { id: "message" }, parts: [] } };
      },
      async promptAsync(input) {
        assert.equal(this.marker, "v1-session");
        v1Calls.push(["promptAsync", input]);
        assert.equal(input.path.id, "parent-session");
        assert.equal(input.body.parts[0].text, "hello");
        return { data: {} };
      },
      async status(input) {
        assert.equal(this.marker, "v1-session");
        v1Calls.push(["status", input]);
        assert.equal(input.query.directory, "root-dir");
        return { data: { "parent-session": { type: "idle" } } };
      },
      async abort(input) {
        assert.equal(this.marker, "v1-session");
        v1Calls.push(["abort", input]);
        assert.equal(input.path.id, "parent-session");
        return { data: true };
      }
    }
  };

  const common = { sessionID: "parent-session", query: { directory: "root-dir", workspace: "workspace-id", limit: 3 } };
  await sessionCreate(v1Client, { parentID: "parent-session", title: "Child", query: common.query });
  await sessionGet(v1Client, common);
  await sessionMessages(v1Client, common);
  await sessionPrompt(v1Client, { sessionID: common.sessionID, query: common.query, body: { parts: [{ type: "text", text: "hello" }] } });
  await sessionPromptAsync(v1Client, { sessionID: common.sessionID, query: common.query, body: { parts: [{ type: "text", text: "hello" }] } });
  await sessionStatus(v1Client, { query: common.query });
  await sessionAbort(v1Client, common);
  assert.deepEqual(v1Calls.map((call) => call[0]), ["create", "get", "messages", "prompt", "promptAsync", "status", "abort"]);

  const v2Calls = [];
  const v2Client = {
    session: {
      marker: "v2-session",
      async create(parameters, options) {
        assert.equal(this.marker, "v2-session");
        assert.equal(options, undefined);
        v2Calls.push(["create", parameters]);
        assert.equal(parameters.parentID, "parent-session");
        assert.equal(parameters.workspace, "workspace-id");
        return { data: { id: "child-session" } };
      },
      async get(parameters, options) {
        assert.equal(this.marker, "v2-session");
        assert.equal(options, undefined);
        v2Calls.push(["get", parameters]);
        assert.equal(parameters.sessionID, "parent-session");
        assert.equal(parameters.workspace, "workspace-id");
        return { data: { id: parameters.sessionID } };
      },
      async messages(parameters, options) {
        assert.equal(this.marker, "v2-session");
        assert.equal(options, undefined);
        v2Calls.push(["messages", parameters]);
        assert.equal(parameters.sessionID, "parent-session");
        assert.equal(parameters.limit, 3);
        return { data: [{ info: { role: "assistant" }, parts: [] }] };
      },
      async prompt(parameters, options) {
        assert.equal(this.marker, "v2-session");
        assert.equal(options, undefined);
        v2Calls.push(["prompt", parameters]);
        assert.equal(parameters.sessionID, "parent-session");
        assert.equal(parameters.parts[0].text, "hello");
        return { data: { info: { id: "message" }, parts: [] } };
      },
      async promptAsync(parameters, options) {
        assert.equal(this.marker, "v2-session");
        assert.equal(options, undefined);
        v2Calls.push(["promptAsync", parameters]);
        assert.equal(parameters.sessionID, "parent-session");
        assert.equal(parameters.parts[0].text, "hello");
        return { data: {} };
      },
      async status(parameters, options) {
        assert.equal(this.marker, "v2-session");
        assert.equal(options, undefined);
        v2Calls.push(["status", parameters]);
        assert.equal(parameters.workspace, "workspace-id");
        return { data: { "parent-session": { type: "idle" } } };
      },
      async abort(parameters, options) {
        assert.equal(this.marker, "v2-session");
        assert.equal(options, undefined);
        v2Calls.push(["abort", parameters]);
        assert.equal(parameters.sessionID, "parent-session");
        return { data: true };
      }
    }
  };

  await sessionCreate(v2Client, { parentID: "parent-session", title: "Child", query: common.query });
  await sessionGet(v2Client, common);
  await sessionMessages(v2Client, common);
  await sessionPrompt(v2Client, { sessionID: common.sessionID, query: common.query, body: { parts: [{ type: "text", text: "hello" }] } });
  await sessionPromptAsync(v2Client, { sessionID: common.sessionID, query: common.query, body: { parts: [{ type: "text", text: "hello" }] } });
  await sessionStatus(v2Client, { query: common.query });
  await sessionAbort(v2Client, common);
  assert.deepEqual(v2Calls.map((call) => call[0]), ["create", "get", "messages", "prompt", "promptAsync", "status", "abort"]);
});

test("OpenCode session prompt adapter does not retry after accepted streaming parse EOF", async () => {
  const calls = [];
  const client = {
    session: {
      async prompt(input) {
        calls.push(input);
        assert.equal(input.path.id, "parent-session");
        throw new Error("JSON Parse error: Unexpected EOF");
      }
    }
  };

  const result = await sessionPrompt(client, {
    sessionID: "parent-session",
    query: { directory: "root-dir" },
    body: { parts: [{ type: "subtask", agent: "project-context-maintainer", description: "Project Context Update", prompt: "Project Context Maintainer job: update" }] }
  });

  assert.equal(result, undefined);
  assert.equal(calls.length, 1);
});

test("OpenCode plugin instance ignores sessions owned by another project directory", async () => {
  const ownerRoot = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-owner-"));
  const foreignRoot = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-foreign-"));
  try {
    let promptCalls = 0;
    let messagesCalls = 0;
    const client = {
      session: {
        async get(input) {
          return { id: input.path.id, directory: ownerRoot };
        },
        async messages() {
          messagesCalls += 1;
          return [];
        },
        async prompt() {
          promptCalls += 1;
          return {};
        }
      }
    };

    const hooks = await publicApi.ProjectContextOpenCodePlugin.server({ client, worktree: foreignRoot, directory: foreignRoot });
    const output = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "foreign-session", model: {} }, output);
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "foreign-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(output.system.length, 0);
    assert.equal(messagesCalls, 0);
    assert.equal(promptCalls, 0);
  } finally {
    await rm(ownerRoot, { recursive: true, force: true });
    await rm(foreignRoot, { recursive: true, force: true });
  }
});

test("OpenCode plugin auto-prepares context, exposes only search, and auto-updates on idle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    let promptAsyncCalls = 0;
    const promptAsyncInputs = [];
    let promptCalls = 0;
    const promptInputs = [];
    let toastCalls = 0;
    const toastInputs = [];
    const updatePayloads = [];
    let parentMessages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "Hello." }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Ready." }] }
    ];
    let createCalls = 0;
    const client = {
      session: {
        bindingMarker: "session-bound",
        async create() {
          assert.equal(this.bindingMarker, "session-bound");
          createCalls += 1;
          return { id: `maintainer-session-${createCalls}` };
        },
        async get(input) {
          assert.equal(input.query.directory, root);
          if (["runtime-update-child", "runtime-blocked-child"].includes(input.path.id)) return { data: { info: { id: input.path.id, parentID: "parent-session" } } };
          return ["child-session", "maintainer-session"].includes(input.path.id) ? { id: input.path.id, parentID: "parent-session" } : { id: input.path.id };
        },
        async promptAsync(input) {
          assert.equal(this.bindingMarker, "session-bound");
          promptAsyncCalls += 1;
          promptAsyncInputs.push(input);
          if (input.body.tools) assert.equal(input.body.tools.project_context_search, false);
          const part = input.body.parts?.[0];
          const text = part?.text ?? "";
          if (/Project Context Maintainer job: update/i.test(text)) {
            assert.equal(input.body.agent, "project-context-maintainer");
            assert.doesNotMatch(text, /latest user request|assistant final|git diff|\.crewbeectxt|HANDOFF\.md/i);
            const jobID = text.match(/"jobID":\s*"(pcu_[a-z0-9_]+)"/i)?.[1];
            assert.ok(jobID);
            const payloadPath = path.join(root, ".crewbee", ".prjctxt", "cache", "update-jobs", `${jobID}.json`);
            const payload = JSON.parse(await readFile(payloadPath, "utf8"));
            updatePayloads.push({ path: payloadPath, payload });
            assert.equal(payload.kind, "project_context_update");
            assert.deepEqual(payload.trigger.reasons.length > 0, true);
            assert.match(payload.parentSession.latestUserRequest, /implement auto update|Hello|请更新上下文/i);
            assert.match(payload.parentSession.assistantFinalText, /Task card|Ready|采用/i);
            assert.ok(Array.isArray(payload.engineeringChanges.changedFiles));
            assert.match(payload.engineeringChanges.gitDiffSummary, /git diff --stat/);
            assert.ok(Array.isArray(payload.engineeringChanges.verification));
          }
          return {};
        },
        async prompt(input) {
          assert.equal(this.bindingMarker, "session-bound");
          promptCalls += 1;
          promptInputs.push(input);
          const part = input.body.parts?.[0];
          if (part?.type === "subtask") {
            const jobID = part.prompt.match(/Job ID:\s*(pcu_[a-z0-9_]+)/i)?.[1];
            assert.ok(jobID);
            assert.equal(part.agent, "project-context-maintainer");
            assert.equal(part.description, "Project Context Update");
            assert.equal(part.command, undefined);
            assert.doesNotMatch(part.prompt, /latest user request|assistant final|git diff|\.crewbeectxt|HANDOFF\.md/i);
            const payloadPath = path.join(root, ".crewbee", ".prjctxt", "cache", "update-jobs", `${jobID}.json`);
            assert.match(part.prompt.replaceAll("\\", "/"), new RegExp(payloadPath.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
            const payload = JSON.parse(await readFile(payloadPath, "utf8"));
            updatePayloads.push({ path: payloadPath, payload });
            assert.equal(payload.kind, "project_context_update");
            assert.deepEqual(payload.trigger.reasons.length > 0, true);
            assert.match(payload.parentSession.latestUserRequest, /implement auto update|Hello|请更新上下文/i);
            assert.match(payload.parentSession.assistantFinalText, /Task card|Ready|采用/i);
            assert.ok(Array.isArray(payload.engineeringChanges.changedFiles));
            assert.match(payload.engineeringChanges.gitDiffSummary, /git diff --stat/);
            assert.ok(Array.isArray(payload.engineeringChanges.verification));
          }
          return {};
        },
        async status() {
          return { "maintainer-session-1": { type: "idle" }, "maintainer-session-2": { type: "idle" }, "maintainer-session-3": { type: "idle" } };
        },
        async messages(input) {
          if (input.path.id !== "parent-session" && input.path.id !== "system-first-session") {
            return [{ role: "assistant", parts: [{ type: "text", text: "Maintainer result from .crewbee/.prjctxt/HANDOFF.md" }] }];
          }
          return parentMessages;
        }
      },
      tui: {
        async showToast(input) {
          toastCalls += 1;
          toastInputs.push(input);
          return {};
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
    assert.equal(config.agent["project-context-maintainer"].permission.read[".crewbee/.prjctxt/cache/update-jobs/**"], "allow");
    assert.equal(config.agent["project-context-maintainer"].permission.edit[".crewbee/.prjctxt/**"], "allow");
    assert.equal(config.agent["project-context-maintainer"].permission.project_context_search, "deny");
    assert.equal(config.agent["project-context-maintainer"].permission["session.prompt"], "deny");
    assert.equal(config.agent["project-context-maintainer"].permission.bash["npm run doctor"], "allow");
    assert.equal(config.agent["project-context-maintainer"].tools.project_context_search, false);
    assert.equal(config.agent["coding-leader"].permission.task["project-context-maintainer"], "deny");
    assert.equal(config.agent.worker.permission.project_context_search, "deny");
    assert.equal(config.agent.worker.tools.project_context_search, false);
    assert.ok(config.watcher.ignore.includes(".crewbee/.prjctxt/cache/**"));

    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "c" }, { args: { subagent_type: "project-context-maintainer" } }), /Do not invoke/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "internal-update" }, { args: { subagent_type: "project-context-maintainer", command: "project_context_update" } }), /Do not invoke/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "project_context_search", sessionID: "child-session", callID: "c", agent: "worker" }, { args: { goal: "x" } }), /root primary-agent sessions/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "project_context_search", sessionID: "maintainer-session", callID: "c", agent: "project-context-maintainer" }, { args: { goal: "x" } }), /must not call project_context/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c", agent: "coding-leader" }, { args: { filePath: ".crewbee/.prjctxt/HANDOFF.md" } }), /Project Context workspace is private/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "legacy", agent: "coding-leader" }, { args: { filePath: ".crewbeectxt/HANDOFF.md" } }), /Project Context workspace is private/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "runtime", agent: "coding-leader" }, { args: { filePath: ".crewbee/.prjctxt/cache/update-jobs/job.json" } }), /Project Context workspace is private/);
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "runtime-maintainer", agent: "project-context-maintainer" }, { args: { filePath: ".crewbee/.prjctxt/cache/update-jobs/job.json" } });
    await hooks["tool.execute.before"]({ tool: "grep", sessionID: "s", callID: "grep", agent: "coding-leader" }, { args: { pattern: [".", "crewbeectxt"].join(""), include: "*.md" } });
    await hooks["tool.execute.before"]({ tool: "apply_patch", sessionID: "s", callID: "patch", agent: "coding-leader" }, { args: { patchText: `Docs mention ${[".", "crewbeectxt"].join("")} without reading it.` } });
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c", agent: "project-context-maintainer" }, { args: { filePath: ".crewbee/.prjctxt/HANDOFF.md" } });
    const redacted = { result: { ".crewbee/.prjctxt/HANDOFF.md": "listed .crewbee/.prjctxt/HANDOFF.md and src/index.ts" } };
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "c", agent: "coding-leader", args: { command: "npm test" } }, redacted);
    assert.deepEqual(redacted.result, { "[project-context-private]": "listed [project-context-private] and src/index.ts" });

    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    await populateTemplateContext(root);
    const visiblePrepare = { message: { id: "msg-visible-prepare", sessionID: "parent-session", role: "user" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, visiblePrepare);
    assert.equal(visiblePrepare.parts.length, 0);
    assert.equal(promptCalls, 0);
    assert.equal(toastCalls, 1);
    assert.equal(toastInputs[0].body.title, "Project Context Prepare Summary");
    assert.equal(toastInputs[0].body.variant, "info");
    assert.match(toastInputs[0].body.message, /Project Context Prepare Summary · compact · revision/);
    assert.doesNotMatch(toastInputs[0].body.message, /.crewbee\/\.prjctxt|.crewbeectxt|STATE\.yaml|HANDOFF\.md|PLAN\.yaml|observations/);
    const rootSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, rootSystem);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(rootSystem.system.length, 1);
    assert.match(rootSystem.system[0], /Project Context is prepared automatically/);
    assert.match(rootSystem.system[0], /Project Context Brief/);
    assert.doesNotMatch(rootSystem.system[0], /.crewbee\/\.prjctxt|.crewbeectxt|STATE\.yaml|HANDOFF\.md|PLAN\.yaml|observations/);
    assert.equal(promptCalls, 0);
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(promptCalls, 0);
    assert.equal(toastCalls, 1);
    const transformed = { messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: toastInputs[0].body.message, metadata: { kind: "project_context_prepare" } }] }, { info: { role: "user" }, parts: [{ type: "text", text: "real user" }] }] };
    await hooks["experimental.chat.messages.transform"]({}, transformed);
    assert.equal(transformed.messages.length, 1);
    assert.equal(transformed.messages[0].parts[0].text, "real user");
    const followupSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, followupSystem);
    assert.equal(followupSystem.system.length, 1);
    assert.doesNotMatch(followupSystem.system[0], /Project Context Brief/);
    await writeFile(path.join(root, ".crewbee", ".prjctxt", "HANDOFF.md"), "# Handoff\n\nRevision changed.\n", "utf8");
    const revisionSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, revisionSystem);
    assert.equal(revisionSystem.system.length, 1);
    assert.match(revisionSystem.system[0], /Project Context Brief/);
    const revisionVisiblePrepare = { message: { id: "msg-visible-prepare-revision", sessionID: "parent-session", role: "user" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, revisionVisiblePrepare);
    assert.equal(revisionVisiblePrepare.parts.length, 0);
    assert.equal(promptCalls, 0);
    assert.equal(toastCalls, 2);
    assert.match(toastInputs[1].body.message, /Project Context Prepare Summary · compact · revision/);
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(promptCalls, 0);
    assert.equal(toastCalls, 2);
    const duplicateVisiblePrepare = { message: { id: "msg-visible-prepare-duplicate", sessionID: "parent-session", role: "user" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, duplicateVisiblePrepare);
    assert.equal(duplicateVisiblePrepare.parts.length, 0);
    const systemFirstSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "system-first-session", model: {} }, systemFirstSystem);
    assert.equal(systemFirstSystem.system.length, 1);
    assert.match(systemFirstSystem.system[0], /Project Context Brief/);
    const systemFirstVisiblePrepare = { message: { id: "msg-visible-prepare-system-first", sessionID: "system-first-session", role: "user" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "system-first-session", agent: "coding-leader" }, systemFirstVisiblePrepare);
    assert.equal(systemFirstVisiblePrepare.parts.length, 0);
    assert.equal(promptCalls, 0);
    assert.equal(toastCalls, 3);
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
    assert.doesNotMatch(searchOutput, /.crewbee\/\.prjctxt|.crewbeectxt/);
    assert.equal(promptAsyncCalls, 1);

    parentMessages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "Please implement auto update." }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "已实现 auto update。决定采用 Task card。下一步运行测试。" }] }
    ];
    await hooks["tool.execute.before"]({ tool: "apply_patch", sessionID: "parent-session", callID: "patch", agent: "coding-leader" }, { args: { patchText: "*** Begin Patch\n*** Update File: src/example.ts\n@@\n-old\n+new\n*** End Patch" } });
    await hooks["tool.execute.after"]({ tool: "apply_patch", sessionID: "parent-session", callID: "patch", agent: "coding-leader" }, { result: "patched src/example.ts" });
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "parent-session", callID: "test", agent: "coding-leader" }, { args: { command: "npm test" } });
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "parent-session", callID: "test", agent: "coding-leader" }, { result: "tests passed" });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await waitFor(() => updatePayloads.length === 1);
    assert.equal(promptAsyncCalls, 1);
    assert.equal(promptCalls, 1);
    assert.equal(createCalls, 1);
    const updateInput = promptInputs.find((input) => input.path.id === "parent-session" && input.body.parts?.[0]?.type === "subtask" && /Project Context Maintainer job: update/i.test(input.body.parts[0].prompt ?? ""));
    assert.ok(updateInput);
    assert.equal(updateInput.body.parts[0].agent, "project-context-maintainer");
    assert.match(updateInput.body.parts[0].prompt, /Project Context Maintainer job: update/);
    assert.equal(promptInputs.some((input) => input.body.parts?.[0]?.text?.includes("Project Context update ·")), false);
    const transformedUpdate = { messages: [{ info: { role: "assistant" }, parts: [updateInput.body.parts[0], { type: "text", text: "normal assistant text" }] }] };
    await hooks["experimental.chat.messages.transform"]({}, transformedUpdate);
    assert.equal(transformedUpdate.messages.length, 1);
    assert.equal(transformedUpdate.messages[0].parts.length, 1);
    assert.equal(transformedUpdate.messages[0].parts[0].text, "normal assistant text");
    assert.ok(updatePayloads[0].payload.trigger.reasons.includes("verification"));
    assert.ok(updatePayloads[0].payload.trigger.reasons.includes("files_changed"));
    assert.ok(updatePayloads[0].payload.engineeringChanges.verification.some((event) => event.resultSummary.includes("tests passed")));
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "runtime-update-child", callID: "payload-read-active", agent: "project-context-maintainer" }, { args: { filePath: updatePayloads[0].path } });
    await hooks["tool.execute.after"]({ tool: "read", sessionID: "runtime-update-child", callID: "payload-read-active", agent: "project-context-maintainer", args: { filePath: updatePayloads[0].path } }, { result: "payload read" });
    await waitFor(async () => {
      try {
        await readFile(updatePayloads[0].path, "utf8");
        return false;
      } catch {
        return true;
      }
    });
    const promptCallsAfterUpdateCleanup = promptCalls;
    const toastCallsAfterUpdateCleanup = toastCalls;
    await writeFile(path.join(root, ".crewbee", ".prjctxt", "HANDOFF.md"), "# Handoff\n\nMaintainer updated context after auto update.\n", "utf8");
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(promptCalls, promptCallsAfterUpdateCleanup);
    assert.equal(toastCalls, toastCallsAfterUpdateCleanup);
    const postUpdateAssistantMessage = { message: { id: "msg-post-update-assistant", sessionID: "parent-session", role: "assistant" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, postUpdateAssistantMessage);
    assert.equal(postUpdateAssistantMessage.parts.length, 0);
    assert.equal(promptCalls, promptCallsAfterUpdateCleanup);
    assert.equal(toastCalls, toastCallsAfterUpdateCleanup);
    const postUpdateVisiblePrepare = { message: { id: "msg-post-update-prepare", sessionID: "parent-session", role: "user" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, postUpdateVisiblePrepare);
    assert.equal(postUpdateVisiblePrepare.parts.length, 0);
    assert.equal(promptCalls, promptCallsAfterUpdateCleanup);
    assert.equal(toastCalls, toastCallsAfterUpdateCleanup + 1);
    const postUpdateSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, postUpdateSystem);
    assert.equal(postUpdateSystem.system.length, 1);
    assert.match(postUpdateSystem.system[0], /Project Context Brief/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "read", sessionID: "runtime-blocked-child", callID: "payload-read-cleaned" }, { args: { filePath: updatePayloads[0].path } }), /Project Context workspace is private/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "read", sessionID: "runtime-blocked-child", callID: "payload-read-blocked" }, { args: { filePath: path.join(root, ".crewbee", ".prjctxt", "cache", "update-jobs", "pcu_missing_job.json") } }), /Project Context workspace is private/);

    parentMessages = [
      ...parentMessages,
      { info: { role: "assistant" }, parts: [{ type: "text", text: updateInput.body.parts[0].prompt }] }
    ];
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(updatePayloads.length, 1);

    await hooks.event({ event: { type: "message.updated", properties: { sessionID: "parent-session", info: { role: "assistant" }, parts: [{ type: "text", text: `Project Context Update failed: missing payload for Job ID: ${updatePayloads[0].payload.jobID}` }] } } });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(updatePayloads.length, 1);

    await hooks.event({ event: { type: "message.updated", properties: { sessionID: "maintainer-session", info: { role: "assistant" }, parts: [{ type: "text", text: "决定更新内部上下文。" }] } } });
    await hooks.event({ event: { type: "session.status", properties: { sessionID: "maintainer-session", status: { type: "idle" } } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(updatePayloads.length, 1);

    parentMessages = [
      ...parentMessages,
      { info: { role: "assistant" }, parts: [{ type: "text", text: "决定采用 auto update，下一步补充验证。" }] }
    ];
    await hooks.event({ event: { type: "message.updated", properties: { sessionID: "parent-session", info: { role: "assistant" }, parts: [{ type: "text", text: "决定采用 auto update，下一步补充验证。" }] } } });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(updatePayloads.length, 1);

    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, { message: { info: { role: "user" } }, parts: [{ type: "text", text: "请更新上下文。" }] });
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, { message: { info: { role: "user" } }, parts: [{ type: "text", text: "请更新上下文。" }] });
    await hooks.event({ event: { type: "session.status", properties: { info: { id: "parent-session" }, status: { type: "idle" } } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(updatePayloads.length, 1);
    await hooks.event({ event: { type: "session.status", properties: { info: { id: "parent-session" }, status: { type: "idle" } } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(updatePayloads.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode prepare summary falls back to synthetic ignored chat part for Web UI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-web-prepare-"));
  try {
    let promptCalls = 0;
    const client = {
      session: {
        async get(input) {
          return { id: input.path.id, directory: root };
        },
        async messages() {
          return [{ info: { role: "user" }, parts: [{ type: "text", text: "Hello." }] }];
        },
        async prompt() {
          promptCalls += 1;
          return {};
        }
      }
    };
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    await populateTemplateContext(root);
    const hooks = await publicApi.ProjectContextOpenCodePlugin.server({ client, worktree: root, directory: root });

    const visiblePrepare = { message: { id: "msg-web-prepare", sessionID: "parent-session", role: "user" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, visiblePrepare);

    assert.equal(promptCalls, 1);
    assert.equal(visiblePrepare.parts.length, 0);

    const transformed = { messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "real user" }, { type: "text", text: "Project Context Prepare Summary · compact · revision abc123", metadata: { kind: "project_context_prepare" } }] }] };
    await hooks["experimental.chat.messages.transform"]({}, transformed);
    assert.equal(transformed.messages.length, 1);
    assert.equal(transformed.messages[0].parts.length, 1);
    assert.equal(transformed.messages[0].parts[0].text, "real user");
  } finally {
    await rmForceRetry(root);
  }
});

test("OpenCode prepare summary remains visible in chat when TUI toast fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-toast-fail-"));
  try {
    const client = {
      session: {
        async get(input) {
          return { id: input.path.id, directory: root };
        },
        async messages() {
          return [];
        },
        async prompt() {
          throw new Error("prepare must not prompt");
        }
      },
      tui: {
        async showToast() {
          throw new Error("toast unavailable in desktop web");
        }
      }
    };
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    await populateTemplateContext(root);
    const hooks = await publicApi.ProjectContextOpenCodePlugin.server({ client, worktree: root, directory: root });

    const visiblePrepare = { message: { id: "msg-toast-fail", sessionID: "parent-session", role: "user" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, visiblePrepare);

    assert.equal(visiblePrepare.parts.length, 1);
    assert.equal(visiblePrepare.parts[0].synthetic, true);
    assert.equal(visiblePrepare.parts[0].ignored, true);
    assert.equal(visiblePrepare.parts[0].metadata.kind, "project_context_prepare");
    assert.match(visiblePrepare.parts[0].text, /Project Context Prepare Summary · compact · revision/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode auto-update detects template scaffold and uses private job payload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-template-update-"));
  try {
    const payloads = [];
    const prompts = [];
    const client = {
      session: {
        async get(input) {
          if (input.path.id === "runtime-update-child") return { id: input.path.id, parentID: "parent-session" };
          return { id: input.path.id };
        },
        async messages() {
          return [
            { info: { role: "user" }, parts: [{ type: "text", text: "Start project." }] },
            { info: { role: "assistant" }, parts: [{ type: "text", text: "Ready." }] }
          ];
        },
        async prompt(input) {
          prompts.push(input);
          const part = input.body.parts?.[0];
          const text = part?.prompt ?? part?.text ?? "";
          if (part?.type === "subtask" && /Project Context Maintainer job: update/i.test(text)) {
            assert.equal(input.path.id, "parent-session");
            assert.equal(part.agent, "project-context-maintainer");
            assert.equal(part.description, "Project Context Update");
            const jobID = text.match(/Job ID:\s*(pcu_[a-z0-9_]+)/i)?.[1];
            assert.ok(jobID);
            const payloadPath = path.join(root, ".crewbee", ".prjctxt", "cache", "update-jobs", `${jobID}.json`);
            assert.match(text.replaceAll("\\", "/"), new RegExp(payloadPath.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
            payloads.push({ path: payloadPath, payload: JSON.parse(await readFile(payloadPath, "utf8")) });
          }
          return {};
        },
        async status() {
          return { "maintainer-session": { type: "idle" } };
        }
      }
    };
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    const hooks = await publicApi.ProjectContextOpenCodePlugin.server({ client, worktree: path.parse(root).root, directory: root });
    await Promise.all(Array.from({ length: 4 }, () => hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } })));
    await waitFor(() => payloads.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(payloads.length, 1);
    assert.ok(payloads[0].payload.trigger.reasons.includes("context_needs_population"));
    assert.equal(prompts[0].body.parts[0].type, "subtask");
    assert.equal(prompts[0].body.parts[0].agent, "project-context-maintainer");
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "runtime-update-child", callID: "template-payload-read", agent: "project-context-maintainer" }, { args: { filePath: payloads[0].path } });
    await hooks["tool.execute.after"]({ tool: "read", sessionID: "runtime-update-child", callID: "template-payload-read", agent: "project-context-maintainer", args: { filePath: payloads[0].path } }, { result: "payload read" });
    await waitFor(async () => {
      try {
        await readFile(payloads[0].path, "utf8");
        return false;
      } catch {
        return true;
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode auto-update failures are best-effort and do not retry without new material", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-update-failure-"));
  try {
    const attemptedJobIDs = new Set();
    const attemptedPayloadPaths = [];
    const parentMessages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "Implement the feature." }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "已实现 feature。决定采用最小方案。下一步运行测试。" }] }
    ];
    let hooks;
    const client = {
      session: {
        async get(input) {
          return { id: input.path.id };
        },
        async messages() {
          return parentMessages;
        },
        async prompt(input) {
          const part = (input.body ?? input).parts?.[0];
          const jobID = part?.prompt?.match(/Job ID:\s*(pcu_[a-z0-9_]+)/i)?.[1];
          if (jobID) {
            attemptedJobIDs.add(jobID);
            attemptedPayloadPaths.push(path.join(root, ".crewbee", ".prjctxt", "cache", "update-jobs", `${jobID}.json`));
            parentMessages.push({ info: { role: "assistant" }, parts: [{ type: "text", text: "已实现 follow-up。下一步继续验证。" }] });
            await hooks.event({ event: { type: "message.updated", properties: { sessionID: "parent-session", info: { role: "assistant" }, parts: [{ type: "text", text: "已实现 follow-up。下一步继续验证。" }] } } });
          }
          throw new Error("simulated update subtask failure");
        },
        async status() {
          return { "maintainer-session": { type: "busy" } };
        }
      }
    };
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    await populateTemplateContext(root);
    hooks = await publicApi.ProjectContextOpenCodePlugin.server({ client, worktree: root, directory: root });

    await hooks["tool.execute.before"]({ tool: "apply_patch", sessionID: "parent-session", callID: "patch", agent: "coding-leader" }, { args: { patchText: "*** Begin Patch\n*** Update File: src/feature.ts\n@@\n-old\n+new\n*** End Patch" } });
    await hooks["tool.execute.after"]({ tool: "apply_patch", sessionID: "parent-session", callID: "patch", agent: "coding-leader" }, { result: "patched src/feature.ts" });
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "parent-session", callID: "test", agent: "coding-leader" }, { args: { command: "npm test" } });
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "parent-session", callID: "test", agent: "coding-leader" }, { result: "tests passed" });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await waitFor(() => attemptedJobIDs.size === 1, 6000);
    await waitFor(async () => {
      try {
        await readFile(attemptedPayloadPaths[0], "utf8");
        return false;
      } catch {
        return true;
      }
    });

    parentMessages.push({ info: { role: "user" }, parts: [{ type: "text", text: "继续处理下一步。" }] });
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, { message: { id: "user-after-aborted-update", sessionID: "parent-session", role: "user" }, parts: [{ type: "text", text: "继续处理下一步。" }] });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(attemptedJobIDs.size, 1);

    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await hooks.event({ event: { type: "message.updated", properties: { sessionID: "parent-session", info: { role: "assistant" }, parts: [{ type: "text", text: "Project Context Update failed for Job ID: pcu_failure_12345678" }] } } });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(attemptedJobIDs.size, 1);

    await hooks.event({ event: { type: "message.updated", properties: { sessionID: "parent-session", info: { role: "assistant" }, parts: [{ type: "text", text: "Project Context workspace is private. Do not access it directly; project_context_search is a rare fallback only for blocking historical context gaps.\n\nUnable to update private Project Context scaffold because the runtime denied access to the update-job payload and workspace files. No files were modified." }] } } });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(attemptedJobIDs.size, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode auto-update ignores commit-only work without engineering file changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-commit-only-"));
  try {
    let promptCalls = 0;
    const client = {
      session: {
        async get(input) {
          return { id: input.path.id, directory: root };
        },
        async messages() {
          return [
            { info: { role: "user" }, parts: [{ type: "text", text: "commit and push" }] },
            { info: { role: "assistant" }, parts: [{ type: "text", text: "已提交并推送。下一步无需处理。" }] }
          ];
        },
        async prompt(input) {
          if (input.body.parts?.[0]?.type === "subtask") promptCalls += 1;
          return {};
        }
      }
    };
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    await populateTemplateContext(root);
    const hooks = await publicApi.ProjectContextOpenCodePlugin.server({ client, worktree: root, directory: root });

    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "parent-session", callID: "test-only", agent: "coding-leader" }, { args: { command: "npm test" } });
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "parent-session", callID: "test-only", agent: "coding-leader" }, { result: "tests passed" });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(promptCalls, 0);

    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "parent-session", callID: "commit", agent: "coding-leader" }, { args: { command: "git commit -m \"test\"" } });
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "parent-session", callID: "commit", agent: "coding-leader" }, { result: "[main abc123] test" });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(promptCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode plugin auto-initializes missing scaffold locally on first root session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-autoinit-"));
  try {
    let createCalls = 0;
    let promptAsyncCalls = 0;
    const client = {
      session: {
        async create(input) {
          createCalls += 1;
          return { id: input.body.parentID };
        },
        async get(input) {
          return { id: input.path.id };
        },
        async promptAsync(input) {
          promptAsyncCalls += 1;
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
    assert.equal(createCalls, 0);
    assert.equal(promptAsyncCalls, 0);
    const validation = await service(root).validateContext();
    assert.equal(validation.ok, true, validation.errors.join("; "));

    await hooks.event({ event: { type: "session.status", properties: { sessionID: "init-maintainer-session", status: { type: "idle" } } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(promptAsyncCalls, 0);
  } finally {
    await rmForceRetry(root);
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

test("OpenCode dependencies and plugin entry are pinned", async () => {
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.equal(pkg.dependencies["@opencode-ai/plugin"], "1.14.28");
  assert.equal(pkg.dependencies["@opencode-ai/sdk"], "1.14.28");
  assert.equal(pkg.devDependencies?.["@opencode-ai/plugin"], undefined);
  assert.equal(pkg.devDependencies?.["@opencode-ai/sdk"], undefined);
  assert.equal(JSON.stringify(pkg.dependencies).includes("latest"), false);
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
        return { info: { id: "maintainer-session" } };
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
  assert.deepEqual(config.plugin, ["crewbee", "crewbee-project-context@0.1.2"]);
  assert.deepEqual(update.migratedEntries, ["crewbee-project-context"]);
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
    await writeFile(configPath, JSON.stringify({ plugin: ["crewbee", "crewbee-project-context@0.1.2"] }, null, 2), "utf8");
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
