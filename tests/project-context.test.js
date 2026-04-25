import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCrewBeePromptFragment, buildPrimer, executeCrewBeeProjectContextTool, finalizeSession, getCrewBeeToolNames, initProjectContext, prepareProjectContext, readContextFile, searchContext, updateContext, validateContext } from "../dist/src/index.js";

test("init creates a valid .crewbee workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    const init = await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    assert.ok(init.created.includes(".crewbee/STATE.yaml"));
    const quickstart = await readFile(path.join(root, ".crewbee", "QUICKSTART.md"), "utf8");
    assert.match(quickstart, /Demo Context Quickstart/);
    const validation = await validateContext(root);
    assert.equal(validation.ok, true, validation.errors.join("; "));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("primer includes project and active step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    const primer = await buildPrimer(root, { budgetTokens: 1000 });
    assert.match(primer.text, /Project Context detected/);
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
    await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    const result = await searchContext(root, "project objective");
    assert.ok(result.items.length > 0);
    assert.ok(result.items.some((item) => item.source.endsWith("PROJECT.md")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepare returns a task context brief", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    const brief = await prepareProjectContext(root, "Implement minimal CrewBee Project Context integration.");
    assert.match(brief.text, /Task Context Brief/);
    assert.match(brief.text, /Project Context detected/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor rejects invalid active step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    await writeFile(path.join(root, ".crewbee", "STATE.yaml"), "project_id: demo\nrun_status: running\nactive_cycle: C1\nactive_step_id: S999\nlast_checkpoint: CP-0001\nblockers: []\nnext_actions:\n  - action: Continue\n    owner: active-agent\n    source: PLAN.yaml\n", "utf8");
    const validation = await validateContext(root);
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.some((error) => error.includes("active_step_id 'S999'")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor rejects missing exact next actions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    await writeFile(path.join(root, ".crewbee", "HANDOFF.md"), "# Session Handoff\n\n## Current Snapshot\n\n- Active step: C1/S1.\n", "utf8");
    const validation = await validateContext(root);
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.some((error) => error.includes("Exact Next Actions")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read rejects paths outside .crewbee", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    await assert.rejects(() => readContextFile(root, "../package.json"), /outside project context/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("updateContext merges state and enforces expectedHash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    await assert.rejects(() => updateContext(root, {
      target: "state",
      operation: "merge",
      payload: { last_checkpoint: "CP-0002" },
      expectedHash: "not-a-real-hash"
    }), /expectedHash/);

    const result = await updateContext(root, {
      target: "state",
      operation: "merge",
      payload: { last_checkpoint: "CP-0002", next_actions: ["Continue implementation"] }
    });
    assert.equal(result.ok, true);
    const state = await readFile(path.join(root, ".crewbee", "STATE.yaml"), "utf8");
    assert.match(state, /last_checkpoint: CP-0002/);
    assert.match(state, /action: Continue implementation/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizeSession writes observation and updates handoff/state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    const result = await finalizeSession(root, {
      title: "Finalize Test",
      summary: "Implemented finalize test flow.",
      changedFiles: ["src/maintainer/finalize-context.ts"],
      verification: ["npm test passed"],
      nextActions: ["Continue S5 hardening"]
    });

    assert.equal(result.ok, true);
    assert.equal(result.checkpointId, "CP-0002");
    assert.ok(result.changedFiles.includes(".crewbee/observations/CP-0002.md"));

    const observation = await readFile(path.join(root, ".crewbee", "observations", "CP-0002.md"), "utf8");
    const handoff = await readFile(path.join(root, ".crewbee", "HANDOFF.md"), "utf8");
    const state = await readFile(path.join(root, ".crewbee", "STATE.yaml"), "utf8");
    assert.match(observation, /Implemented finalize test flow/);
    assert.match(handoff, /Continue S5 hardening/);
    assert.match(state, /last_checkpoint: CP-0002/);

    const validation = await validateContext(root);
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
      "project_context_finalize_request"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalize_request bootstraps .crewbee when context is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    const finalized = await executeCrewBeeProjectContextTool(root, "project_context_finalize_request", {
      summary: "Create project context after material progress.",
      nextActions: ["Continue with prepared context"]
    });
    assert.equal(finalized.ok, true);
    const validation = await validateContext(root);
    assert.equal(validation.ok, true, validation.errors.join("; "));
    const handoff = await readFile(path.join(root, ".crewbee", "HANDOFF.md"), "utf8");
    assert.match(handoff, /Create project context after material progress/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CrewBee bridge executes prepare, search, and finalize_request tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    const fragment = await buildCrewBeePromptFragment(root);
    assert.equal(fragment.enabled, true);
    assert.match(fragment.text, /Project Context detected/);

    const prepared = await executeCrewBeeProjectContextTool(root, "project_context_prepare", { goal: "Use project context with minimal attention." });
    assert.match(prepared.text, /Task Context Brief/);

    const search = await executeCrewBeeProjectContextTool(root, "project_context_search", { goal: "project objective" });
    assert.match(search.text, /Project Context Search Result/);

    const finalized = await executeCrewBeeProjectContextTool(root, "project_context_finalize_request", {
      summary: "Bridge finalize executed.",
      nextActions: ["Continue minimal integration"]
    });
    assert.equal(finalized.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
