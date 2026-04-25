import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCrewBeePromptFragment, buildPrimer, executeCrewBeeProjectContextTool, finalizeSession, getCrewBeeToolNames, initProjectContext, migrateProjectContext, readContextFile, searchContext, updateContext, validateContext } from "../src/index.js";

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

test("migrate converts .agent to .crewbee and rewrites text references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await initProjectContext(root, { contextDir: ".agent", projectId: "demo", projectName: "Demo" });
    await writeFile(path.join(root, ".agent", "HANDOFF.md"), "# Session Handoff\n\n## Current Snapshot\n\n- Read .agent/STATE.yaml.\n\n## Exact Next Actions\n\n1. Migrate .agent to .crewbee.\n", "utf8");

    const result = await migrateProjectContext(root);
    assert.equal(result.sourceDir, ".agent");
    assert.equal(result.targetDir, ".crewbee");
    assert.ok(result.rewrittenFiles.some((file) => file.endsWith("HANDOFF.md")));

    const handoff = await readFile(path.join(root, ".crewbee", "HANDOFF.md"), "utf8");
    assert.match(handoff, /\.crewbee\/STATE\.yaml/);
    assert.doesNotMatch(handoff, /\.agent/);

    const validation = await validateContext(root);
    assert.equal(validation.ok, true, validation.errors.join("; "));
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
      changedFiles: ["src/finalize/finalize-session.js"],
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
      "project_context_read",
      "project_context_search",
      "project_context_finalize"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CrewBee bridge executes read and search tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewbee-context-"));
  try {
    await initProjectContext(root, { projectId: "demo", projectName: "Demo" });
    const fragment = await buildCrewBeePromptFragment(root);
    assert.equal(fragment.enabled, true);
    assert.match(fragment.text, /Project Context detected/);

    const read = await executeCrewBeeProjectContextTool(root, "project_context_read", { path: ".crewbee/HANDOFF.md" });
    assert.match(read.text, /Session Handoff/);

    const search = await executeCrewBeeProjectContextTool(root, "project_context_search", { query: "project objective" });
    assert.ok(search.items.length > 0);

    const finalized = await executeCrewBeeProjectContextTool(root, "project_context_finalize", {
      summary: "Bridge finalize executed.",
      nextActions: ["Continue minimal integration"]
    });
    assert.equal(finalized.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
