import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as publicApi from "../dist/src/index.js";
import { buildCrewBeePromptFragment, executeCrewBeeProjectContextTool, getCrewBeeToolNames, prepareProjectContext } from "../dist/src/index.js";
import { ProjectContextService } from "../dist/src/service/project-context-service.js";
import { hasRecommendedPluginOrder, runInstallDoctor, upsertProjectContextPluginEntry } from "../dist/src/install/index.js";

const service = (root) => new ProjectContextService(root);

test("public package surface stays focused on CrewBee sidecar usage", () => {
  assert.equal("project_context_read" in publicApi, false);
  assert.equal("readContextFile" in publicApi, false);
  assert.equal("updateContext" in publicApi, false);
  assert.equal("initProjectContext" in publicApi, false);
  assert.equal("finalizeSession" in publicApi, false);
  assert.equal(typeof publicApi.executeCrewBeeProjectContextTool, "function");
  assert.equal(typeof publicApi.requestProjectContextFinalize, "function");
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
    assert.deepEqual(primer.sourceFiles, []);
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
    assert.match(brief.text, /Task Context Brief/);
    assert.match(brief.text, /Project Context: available/);
    assert.doesNotMatch(brief.text, /\.crewbeectxt/);
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

test("read rejects paths outside .crewbeectxt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    await assert.rejects(() => service(root).readContextFile("../package.json"), /outside project context/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("updateContext merges state and enforces expectedHash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    await assert.rejects(() => service(root).updateContext({
      target: "state",
      operation: "merge",
      payload: { last_checkpoint: "CP-0002" },
      expectedHash: "not-a-real-hash"
    }), /expectedHash/);

    const result = await service(root).updateContext({
      target: "state",
      operation: "merge",
      payload: { last_checkpoint: "CP-0002", next_actions: ["Continue implementation"] }
    });
    assert.equal(result.ok, true);
    const state = await readFile(path.join(root, ".crewbeectxt", "STATE.yaml"), "utf8");
    assert.match(state, /last_checkpoint: CP-0002/);
    assert.match(state, /action: Continue implementation/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizeSession writes observation and updates handoff/state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    const result = await service(root).finalizeSession({
      title: "Finalize Test",
      summary: "Implemented finalize test flow.",
      changedFiles: ["src/maintainer/finalize-context.ts"],
      verification: ["npm test passed"],
      nextActions: ["Continue S5 hardening"]
    });

    assert.equal(result.ok, true);
    assert.equal(result.doctor.ok, true, result.doctor.errors.join("; "));
    assert.equal(result.checkpointId, "CP-0002");
    assert.ok(result.changedFiles.includes(".crewbeectxt/observations/CP-0002.md"));

    const observation = await readFile(path.join(root, ".crewbeectxt", "observations", "CP-0002.md"), "utf8");
    const handoff = await readFile(path.join(root, ".crewbeectxt", "HANDOFF.md"), "utf8");
    const state = await readFile(path.join(root, ".crewbeectxt", "STATE.yaml"), "utf8");
    assert.match(observation, /Implemented finalize test flow/);
    assert.match(handoff, /Continue S5 hardening/);
    assert.match(state, /last_checkpoint: CP-0002/);

    const validation = await service(root).validateContext();
    assert.equal(validation.ok, true, validation.errors.join("; "));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CrewBee bridge stays minimal and disabled when context is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    const fragment = await buildCrewBeePromptFragment(root);
    assert.equal(fragment.enabled, false);
    assert.deepEqual(getCrewBeeToolNames(), [
      "project_context_prepare",
      "project_context_search",
      "project_context_finalize"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalize does not bootstrap .crewbeectxt without material progress", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    const finalized = await executeCrewBeeProjectContextTool(root, "project_context_finalize", {});
    assert.equal(finalized.ok, false);
    assert.equal(finalized.checkpointId, null);
    assert.match(finalized.warnings.join("\n"), /did not include material project progress/);
    await assert.rejects(() => readFile(path.join(root, ".crewbeectxt", "STATE.yaml"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalize bootstraps .crewbeectxt when context is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    const finalized = await executeCrewBeeProjectContextTool(root, "project_context_finalize", {
      summary: "Create project context after material progress.",
      changed_files: ["src/integrations/crewbee/tool-handlers.ts"],
      next_actions: ["Continue with prepared context"]
    });
    assert.equal(finalized.ok, true);
    assert.equal(finalized.doctor.ok, true, finalized.doctor.errors.join("; "));
    const validation = await service(root).validateContext();
    assert.equal(validation.ok, true, validation.errors.join("; "));
    const handoff = await readFile(path.join(root, ".crewbeectxt", "HANDOFF.md"), "utf8");
    assert.match(handoff, /Create project context after material progress/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CrewBee bridge executes prepare, search, and finalize tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    const fragment = await buildCrewBeePromptFragment(root);
    assert.equal(fragment.enabled, true);
    assert.match(fragment.text, /Project Context: available/);
    assert.doesNotMatch(fragment.text, /\.crewbeectxt/);

    const prepared = await executeCrewBeeProjectContextTool(root, "project_context_prepare", { goal: "Use project context with minimal attention." });
    assert.match(prepared.text, /Task Context Brief/);

    const search = await executeCrewBeeProjectContextTool(root, "project_context_search", { goal: "project objective" });
    assert.match(search.text, /Project Context Search Result/);

    const finalized = await executeCrewBeeProjectContextTool(root, "project_context_finalize", {
      summary: "Bridge finalize executed.",
      nextActions: ["Continue minimal integration"]
    });
    assert.equal(finalized.ok, true);
    assert.equal(finalized.doctor.ok, true, finalized.doctor.errors.join("; "));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode plugin exposes hidden maintainer and three tools without compaction hook", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    const client = {
      session: {
        async create() {
          return { id: "maintainer-session" };
        },
        async prompt() {
          return {};
        },
        async messages() {
          return [{ role: "assistant", parts: [{ type: "text", text: "Maintainer result from .crewbeectxt/HANDOFF.md" }] }];
        }
      }
    };
    const hooks = await publicApi.ProjectContextOpenCodePlugin.server({ client, worktree: root, directory: root });
    assert.equal("experimental.session.compacting" in hooks, false);
    assert.deepEqual(Object.keys(hooks.tool).sort(), [
      "project_context_finalize",
      "project_context_prepare",
      "project_context_search"
    ]);

    const config = { agent: { "coding-leader": { mode: "primary", permission: {} } } };
    await hooks.config(config);
    assert.equal(config.agent["project-context-maintainer"].hidden, true);
    assert.equal(config.agent["project-context-maintainer"].mode, "subagent");
    assert.equal(config.agent["coding-leader"].permission.task["project-context-maintainer"], "deny");
    assert.ok(config.watcher.ignore.includes(".crewbeectxt/cache/**"));

    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "c" }, { args: { subagent_type: "project-context-maintainer" } }), /Do not invoke/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c", agent: "coding-leader" }, { args: { filePath: ".crewbeectxt/HANDOFF.md" } }), /Project Context workspace is private/);
    await assert.rejects(() => hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c", agent: "coding-leader" }, { args: { ".crewbeectxt/HANDOFF.md": true } }), /Project Context workspace is private/);
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c", agent: "project-context-maintainer" }, { args: { filePath: ".crewbeectxt/HANDOFF.md" } });
    const redacted = { result: { ".crewbeectxt/HANDOFF.md": "listed .crewbeectxt/HANDOFF.md and src/index.ts" } };
    await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "c", agent: "coding-leader" }, redacted);
    assert.deepEqual(redacted.result, { "[project-context-private]": "listed [project-context-private] and src/index.ts" });
    const output = await hooks.tool.project_context_prepare.execute({ goal: "Understand current plan." }, {
      sessionID: "parent-session",
      messageID: "message",
      agent: "coding-leader",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {}
    });
    assert.equal(output, "Maintainer result from [project-context-private]");
    await service(root).initProjectContext({ projectId: "demo", projectName: "Demo" });
    const finalizeOutput = await hooks.tool.project_context_finalize.execute({ summary: "Updated project context." }, {
      sessionID: "parent-session",
      messageID: "message",
      agent: "coding-leader",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {}
    });
    assert.match(finalizeOutput, /Project Context finalized/);
    assert.doesNotMatch(finalizeOutput, /\.crewbeectxt|STATE\.yaml|HANDOFF\.md|MEMORY_INDEX|observations/);
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
    assert.equal(result.hasThreeToolSurface, true);
    assert.equal(result.noProjectContextReadTool, true);
    assert.equal(result.noCompactionHook, true);
    assert.equal(result.maintainerTaskDeniedForPrimaryAgent, true);
    assert.equal(result.hasToolPrivatePathGuard, true);
    assert.equal(result.hasToolOutputRedactor, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
