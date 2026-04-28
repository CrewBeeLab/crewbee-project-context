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
const CONTEXT_DIR = ".crewbee/.prjctxt";
const contextPath = (root, ...parts) => path.join(root, ".crewbee", ".prjctxt", ...parts);

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
    assert.ok(init.created.includes(`${CONTEXT_DIR}/STATE.yaml`));
    const quickstart = await readFile(contextPath(root, "QUICKSTART.md"), "utf8");
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
    assert.doesNotMatch(primer.text, /\.crewbee\/\.prjctxt/);
    assert.equal(primer.warnings.some((warning) => warning.includes(CONTEXT_DIR)), false);
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
    assert.doesNotMatch(brief.text, /\.crewbee\/\.prjctxt/);
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
    await writeFile(contextPath(root, "STATE.yaml"), "project_id: demo\nrun_status: running\nactive_cycle: C1\nactive_step_id: S999\nlast_checkpoint: CP-0001\nblockers: []\nnext_actions:\n  - action: Continue\n    owner: active-agent\n    source: PLAN.yaml\n", "utf8");
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
    await writeFile(contextPath(root, "HANDOFF.md"), "# Session Handoff\n\n## Current Snapshot\n\n- Active step: C1/S1.\n", "utf8");
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
    assert.doesNotMatch(fragment.text, /\.crewbee\/\.prjctxt/);

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
    const promptAsyncInputs = [];
    let promptCalls = 0;
    const promptInputs = [];
    let createCalls = 0;
    let includeMaterialMessages = false;
    let materialAssistantText = "已实现 auto update。决定采用 subtask Task card。下一步补充 Desktop smoke test。npm test passed.";
    const visiblePreparePromptInputs = () => promptAsyncInputs.filter((input) => input.body?.noReply === true && input.body?.parts?.[0]?.metadata?.kind === "project_context_prepare");
    const client = {
      session: {
        async create() {
          createCalls += 1;
          return { id: "maintainer-session" };
        },
        async get(input) {
          assert.equal(input.query.directory, root);
          assert.ok(input.path.id);
          return input.path.id === "child-session" || input.path.id === "maintainer-session" ? { id: input.path.id, parentID: "parent-session" } : { id: input.path.id };
        },
        async promptAsync(input) {
          assert.equal(this, client.session);
          promptAsyncCalls += 1;
          promptAsyncInputs.push(input);
          if (input.body.tools) assert.equal(input.body.tools.project_context_search, false);
          return {};
        },
        async prompt(input) {
          assert.equal(this, client.session);
          promptCalls += 1;
          promptInputs.push(input);
          return {};
        },
        async status() {
          return { "maintainer-session": { type: "idle" } };
        },
        async messages(input) {
          assert.ok(input?.path?.id);
          if (input?.path?.id === "parent-session") {
            if (!includeMaterialMessages) return [{ role: "assistant", parts: [{ type: "text", text: "No material project-context update needed." }] }];
            return [
              { role: "user", parts: [{ type: "text", text: "Please run tests and update the implementation." }] },
              { role: "assistant", parts: [{ type: "text", text: materialAssistantText }] }
            ];
          }
          return [{ role: "assistant", parts: [{ type: "text", text: `Maintainer result from ${CONTEXT_DIR}/HANDOFF.md` }] }];
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
    assert.ok(config.watcher.ignore.includes(`${CONTEXT_DIR}/cache/**`));

    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "c" }, { args: { subagent_type: "project-context-maintainer" } }), /Do not invoke/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "spoofed-update" }, { args: { subagent_type: "project-context-maintainer", command: "project_context_update" } }), /Do not invoke/);
    const internalUpdatePrompt = [
      "Project Context Maintainer job: update",
      "",
      "Job ID: update-test-12345678",
      `Job payload file: ${CONTEXT_DIR}/cache/update-jobs/update-test-12345678.json`,
      "",
      "Instruction:",
      "- Update only the private Project Context scaffold/workspace."
    ].join("\n");
    await hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "internal-update" }, { args: { subagent_type: "project-context-maintainer", command: "project_context_update", prompt: internalUpdatePrompt } });
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "project_context_search", sessionID: "child-session", callID: "c", agent: "worker" }, { args: { goal: "x" } }), /root primary-agent sessions/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "project_context_search", sessionID: "maintainer-session", callID: "c", agent: "project-context-maintainer" }, { args: { goal: "x" } }), /must not call project_context/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c", agent: "coding-leader" }, { args: { filePath: `${CONTEXT_DIR}/HANDOFF.md` } }), /Project Context workspace is private/);
    await hooks["tool.execute.before"]({ tool: "grep", sessionID: "s", callID: "grep", agent: "coding-leader" }, { args: { pattern: CONTEXT_DIR, include: "*.md" } });
    await hooks["tool.execute.before"]({ tool: "apply_patch", sessionID: "s", callID: "patch", agent: "coding-leader" }, { args: { patchText: `Docs mention ${CONTEXT_DIR} without reading it.` } });
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c", agent: "project-context-maintainer" }, { args: { filePath: `${CONTEXT_DIR}/HANDOFF.md` } });
    const redacted = { result: { [`${CONTEXT_DIR}/HANDOFF.md`]: `listed ${CONTEXT_DIR}/HANDOFF.md and src/index.ts` } };
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "c", agent: "coding-leader", args: { command: "npm test" } }, redacted);
    assert.deepEqual(redacted.result, { "[project-context-private]": "listed [project-context-private] and src/index.ts" });

    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    const visiblePrepare = { message: { id: "msg-visible-prepare", sessionID: "parent-session", role: "user" }, parts: [{ id: "prt-user", messageID: "msg-visible-prepare", sessionID: "parent-session", type: "text", text: "了解当前项目" }] };
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, visiblePrepare);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(visiblePrepare.parts.length, 1);
    assert.equal(visiblePrepare.parts[0].type, "text");
    assert.equal(visiblePrepare.parts[0].text, "了解当前项目");
    assert.equal(promptCalls, 0);
    assert.equal(visiblePreparePromptInputs().length, 1);
    assert.equal(visiblePreparePromptInputs()[0].path.id, "parent-session");
    assert.equal(visiblePreparePromptInputs()[0].body.noReply, true);
    assert.equal(visiblePreparePromptInputs()[0].body.parts[0].type, "text");
    assert.equal(visiblePreparePromptInputs()[0].body.parts[0].ignored, true);
    assert.match(visiblePreparePromptInputs()[0].body.parts[0].text, /Project Context prepared · compact · revision/);
    assert.doesNotMatch(visiblePreparePromptInputs()[0].body.parts[0].text, /\.crewbee\/\.prjctxt|STATE\.yaml|HANDOFF\.md|PLAN\.yaml|observations/);
    const rootSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, rootSystem);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(rootSystem.system.length, 1);
    assert.match(rootSystem.system[0], /Project Context is prepared automatically/);
    assert.match(rootSystem.system[0], /Project Context Brief/);
    assert.doesNotMatch(rootSystem.system[0], /\.crewbee\/\.prjctxt|STATE\.yaml|HANDOFF\.md|PLAN\.yaml|observations/);
    assert.equal(promptCalls, 0);
    const followupSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, followupSystem);
    assert.equal(followupSystem.system.length, 1);
    assert.doesNotMatch(followupSystem.system[0], /Project Context Brief/);
    await writeFile(contextPath(root, "HANDOFF.md"), "# Handoff\n\nRevision changed.\n", "utf8");
    const revisionSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "parent-session", model: {} }, revisionSystem);
    assert.equal(revisionSystem.system.length, 1);
    assert.match(revisionSystem.system[0], /Project Context Brief/);
    const revisionVisiblePrepare = { message: { id: "msg-visible-prepare-revision", sessionID: "parent-session", role: "user" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, revisionVisiblePrepare);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(revisionVisiblePrepare.parts.length, 0);
    assert.equal(visiblePreparePromptInputs().length, 2);
    assert.match(visiblePreparePromptInputs()[1].body.parts[0].text, /Project Context prepared · compact · revision/);
    const duplicateVisiblePrepare = { message: { id: "msg-visible-prepare-duplicate", sessionID: "parent-session", role: "user" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, duplicateVisiblePrepare);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(duplicateVisiblePrepare.parts.length, 0);
    assert.equal(visiblePreparePromptInputs().length, 2);
    const systemFirstSystem = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "system-first-session", model: {} }, systemFirstSystem);
    assert.equal(systemFirstSystem.system.length, 1);
    assert.match(systemFirstSystem.system[0], /Project Context Brief/);
    const systemFirstVisiblePrepare = { message: { id: "msg-visible-prepare-system-first", sessionID: "system-first-session", role: "user" }, parts: [] };
    await hooks["chat.message"]({ sessionID: "system-first-session", agent: "coding-leader" }, systemFirstVisiblePrepare);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(systemFirstVisiblePrepare.parts.length, 0);
    assert.equal(visiblePreparePromptInputs().length, 3);
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
    assert.doesNotMatch(searchOutput, /\.crewbee\/\.prjctxt/);
    assert.ok(promptAsyncCalls >= 4);

    await writeFile(contextPath(root, "PROJECT.md"), "# Project\n\n## Objective\n\nProject context is populated for the test.\n", "utf8");
    await writeFile(contextPath(root, "ARCHITECTURE.md"), "# Architecture\n\n## System Map\n\nRuntime plugin and service modules.\n", "utf8");
    await writeFile(contextPath(root, "IMPLEMENTATION.md"), "# Implementation Snapshot\n\n## What Works\n\nAuto prepare and update.\n\n## Verification Commands\n\nnpm test\n", "utf8");
    await writeFile(contextPath(root, "HANDOFF.md"), "# Session Handoff\n\n## Current Snapshot\n\n- Populated.\n\n## Exact Next Actions\n\n1. Continue validation.\n", "utf8");

    includeMaterialMessages = true;
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "parent-session", callID: "test", agent: "coding-leader" }, { args: { command: "npm test" } });
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "parent-session", callID: "test", agent: "coding-leader" }, { result: "ok" });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.ok(promptAsyncCalls >= 4);
    assert.equal(createCalls, 1);
    const updateInput = promptInputs.find((input) => input.path.id === "parent-session" && input.body.parts?.[0]?.type === "subtask" && input.body.parts[0].prompt?.includes("Project Context Maintainer job: update"));
    assert.ok(updateInput);
    assert.equal(updateInput.query.directory, root);
    assert.equal(updateInput.query.workspace, root);
    assert.equal(updateInput.body.agent, undefined);
    assert.equal(updateInput.body.tools, undefined);
    assert.equal(updateInput.body.parts.length, 1);
    const updatePart = updateInput.body.parts[0];
    assert.equal(updatePart.type, "subtask");
    assert.equal(updatePart.agent, "project-context-maintainer");
    assert.equal(updatePart.command, "project_context_update");
    assert.equal(updatePart.description, "Project Context update");
    assert.match(updatePart.prompt, /Job payload file: \.crewbee\/\.prjctxt\/cache\/update-jobs\/update-[^\s]+\.json/);
    assert.doesNotMatch(updatePart.prompt, /latest user request: Please run tests and update the implementation|assistant final summary|git status summary|git diff summary|verification commands|=> ok|决定采用 subtask Task card/);
    assert.match(updatePart.prompt, /Instruction:/);
    assert.match(updatePart.prompt, /Read the JSON payload from the job payload file before updating context/);
    assert.match(updatePart.prompt, /Update only the private Project Context scaffold/);
    const jobFile = updatePart.prompt.match(/Job payload file:\s*(.+)$/m)?.[1].trim();
    assert.ok(jobFile);
    assert.match(jobFile, /^\.crewbee\/\.prjctxt\/cache\/update-jobs\/update-[A-Za-z0-9-]+\.json$/);
    const jobPayload = JSON.parse(await readFile(path.join(root, jobFile), "utf8"));
    assert.match(jobPayload.jobID, /^update-[A-Za-z0-9-]+$/);
    assert.equal(typeof jobPayload.createdAt, "string");
    assert.ok(jobPayload.payload.trigger.reasons.includes("verification"));
    assert.ok(jobPayload.payload.trigger.reasons.includes("decision"));
    assert.ok(jobPayload.payload.trigger.reasons.includes("plan_or_next_actions"));
    assert.ok(jobPayload.payload.trigger.reasons.includes("implementation_state"));
    assert.deepEqual(jobPayload.payload.trigger.toolEvents, ["bash:verification"]);
    assert.match(jobPayload.payload.parentSessionSummary.latestUserRequest, /Please run tests and update the implementation/);
    assert.match(jobPayload.payload.parentSessionSummary.assistantFinalText, /决定采用 subtask Task card/);
    assert.match(jobPayload.payload.parentSessionSummary.decisions[0], /决定采用 subtask Task card/);
    assert.match(jobPayload.payload.parentSessionSummary.nextActions[0], /下一步补充 Desktop smoke test/);
    assert.equal(Array.isArray(jobPayload.payload.engineeringChanges.changedFiles), true);
    assert.equal(typeof jobPayload.payload.engineeringChanges.gitStatusSummary, "string");
    assert.equal(typeof jobPayload.payload.engineeringChanges.gitDiffSummary, "string");
    assert.match(jobPayload.payload.engineeringChanges.verificationOutputs[0], /=> ok/);
    assert.match(jobPayload.payload.instruction.join("\n"), /Update only the private Project Context scaffold\/workspace/);
    assert.equal(promptCalls, 1);
    assert.equal(promptInputs.some((input) => input.body?.parts?.some((part) => part.text?.includes("Project Context update · started"))), false);

    includeMaterialMessages = false;
    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, { message: { info: { role: "user" } }, parts: [{ type: "text", text: "Project Context update · started · job update-test", ignored: true }] });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.ok(promptAsyncCalls >= 4);

    await hooks["tool.execute.after"]({ tool: "task", sessionID: "parent-session", callID: "internal-update", agent: "coding-leader", args: { subagent_type: "project-context-maintainer", command: "project_context_update", prompt: updatePart.prompt } }, { result: "done" });
    await assert.rejects(() => readFile(path.join(root, jobFile), "utf8"), /ENOENT/);
    const siblingPayload = contextPath(root, "cache", "sibling.json");
    await writeFile(siblingPayload, "keep", "utf8");
    const traversalPrompt = updatePart.prompt.replace(/Job payload file:.+$/m, `Job payload file: ${CONTEXT_DIR}/cache/update-jobs/../sibling.json`);
    await hooks["tool.execute.after"]({ tool: "task", sessionID: "parent-session", callID: "bad-internal-update", agent: "coding-leader", args: { subagent_type: "project-context-maintainer", command: "project_context_update", prompt: traversalPrompt } }, { result: "done" });
    assert.equal(await readFile(siblingPayload, "utf8"), "keep");

    await hooks.event({ event: { type: "message.updated", properties: { sessionID: "maintainer-session", info: { role: "assistant" }, parts: [{ type: "text", text: "决定更新内部上下文。" }] } } });
    await hooks.event({ event: { type: "session.status", properties: { sessionID: "maintainer-session", status: { type: "idle" } } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(promptAsyncCalls >= 4);

    includeMaterialMessages = true;
    materialAssistantText = "决定采用 auto update，下一步补充验证。";
    await hooks.event({ event: { type: "message.updated", properties: { sessionID: "parent-session", info: { role: "assistant" }, parts: [{ type: "text", text: "决定采用 auto update，下一步补充验证。" }] } } });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.ok(promptAsyncCalls >= 4);
    assert.equal(promptCalls, 2);
    const updateSubtasksAfterSecondTurn = promptInputs.filter((input) => input.path.id === "parent-session" && input.body.parts?.[0]?.type === "subtask" && input.body.parts[0].command === "project_context_update");
    assert.equal(updateSubtasksAfterSecondTurn.length, 2);
    const secondJobFile = updateSubtasksAfterSecondTurn[1].body.parts[0].prompt.match(/Job payload file:\s*(.+)$/m)?.[1].trim();
    assert.ok(secondJobFile);
    assert.notEqual(secondJobFile, jobFile);
    assert.match(JSON.parse(await readFile(path.join(root, secondJobFile), "utf8")).payload.parentSessionSummary.assistantFinalText, /决定采用 auto update/);

    await hooks["chat.message"]({ sessionID: "parent-session", agent: "coding-leader" }, { message: { info: { role: "user" } }, parts: [{ type: "text", text: "请更新上下文。" }] });
    await hooks.event({ event: { type: "session.status", properties: { info: { id: "parent-session" }, status: { type: "idle" } } } });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.ok(promptAsyncCalls >= 4);
    assert.equal(promptCalls, 3);
    const updateSubtasksAfterThirdTurn = promptInputs.filter((input) => input.path.id === "parent-session" && input.body.parts?.[0]?.type === "subtask" && input.body.parts[0].command === "project_context_update");
    assert.equal(updateSubtasksAfterThirdTurn.length, 3);
    const thirdJobFile = updateSubtasksAfterThirdTurn[2].body.parts[0].prompt.match(/Job payload file:\s*(.+)$/m)?.[1].trim();
    assert.ok(thirdJobFile);
    assert.notEqual(thirdJobFile, jobFile);
    assert.notEqual(thirdJobFile, secondJobFile);
    assert.match(JSON.parse(await readFile(path.join(root, thirdJobFile), "utf8")).payload.parentSessionSummary.latestUserRequest, /请更新上下文/);

    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo", force: true });
    includeMaterialMessages = false;
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "general-session" } } });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const scaffoldPopulationUpdate = promptInputs.find((input) => input.path.id === "general-session" && input.body.parts?.[0]?.type === "subtask");
    assert.ok(scaffoldPopulationUpdate);
    const scaffoldJobFile = scaffoldPopulationUpdate.body.parts[0].prompt.match(/Job payload file:\s*(.+)$/m)?.[1].trim();
    assert.ok(scaffoldJobFile);
    assert.ok(JSON.parse(await readFile(path.join(root, scaffoldJobFile), "utf8")).payload.trigger.reasons.includes("context_needs_population"));
    await new Promise((resolve) => setTimeout(resolve, 150));
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
          return { info: { id: "init-maintainer-session" } };
        },
        async get(input) {
          assert.ok(input.path.id);
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
        assert.ok(input.path.id);
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
  assert.deepEqual(config.plugin, ["crewbee", "crewbee-project-context@latest"]);
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
    await writeFile(configPath, JSON.stringify({ plugin: ["crewbee", "crewbee-project-context@latest"] }, null, 2), "utf8");
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
