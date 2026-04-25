import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "../core/constants.js";
import { ProjectContextError } from "../core/errors.js";
import type { ContextPatch, ContextPatchTarget, ContextUpdateResult, SessionAction } from "../core/types.js";
import { OptimisticFileWriter } from "../workspace/optimistic-write.js";
import { FileSystemProjectContextStore } from "../workspace/workspace-store.js";

const TARGET_FILES: Record<ContextPatchTarget, string> = {
  state: "STATE.yaml",
  handoff: "HANDOFF.md",
  memory: "MEMORY_INDEX.md",
  decision: "DECISIONS.md"
};

export class ContextUpdater {
  private readonly writer: OptimisticFileWriter;

  public constructor(private readonly store: FileSystemProjectContextStore) {
    this.writer = new OptimisticFileWriter(store);
  }

  public async update(patch: ContextPatch): Promise<ContextUpdateResult> {
    const fileName = TARGET_FILES[patch.target];
    const filePath = path.join(this.store.paths.contextDir(), fileName);
    if (!(await this.store.exists(filePath))) {
      throw new ProjectContextError(`Context file does not exist: ${DEFAULT_CONTEXT_DIR}/${fileName}`);
    }
    const current = await this.writer.readWithHash(filePath);
    const nextText = this.renderPatch(current.text, patch);
    const nextHash = await this.writer.writeIfHashMatches(filePath, nextText, patch.expectedHash);
    return {
      ok: true,
      target: patch.target,
      file: `${DEFAULT_CONTEXT_DIR}/${fileName}`,
      previousHash: current.hash,
      nextHash,
      changed: current.text !== nextText
    };
  }

  private renderPatch(currentText: string, patch: ContextPatch): string {
    const operation = patch.operation ?? "merge";
    if (operation === "replace") return this.payloadToText(patch.payload);
    if (operation === "append") return `${currentText.trimEnd()}\n\n${this.payloadToText(patch.payload).trim()}\n`;
    if (operation === "merge") {
      if (patch.target !== "state") throw new ProjectContextError("merge operation is currently supported only for state updates.");
      return this.mergeStateYaml(currentText, patch.payload);
    }
    throw new ProjectContextError(`Unsupported update operation: ${operation}`);
  }

  private payloadToText(payload: unknown): string {
    if (typeof payload === "string") return payload;
    if (this.isRecord(payload) && typeof payload.text === "string") return payload.text;
    return JSON.stringify(payload, null, 2);
  }

  private mergeStateYaml(currentText: string, payload: unknown): string {
    if (!this.isRecord(payload)) throw new ProjectContextError("state merge payload must be an object.");
    let text = currentText;
    for (const [key, value] of Object.entries(payload)) {
      if (Array.isArray(value)) continue;
      if (value === null || value === undefined) continue;
      text = this.setTopLevelScalar(text, this.toSnakeCase(key), String(value));
    }
    const nextActions = payload.next_actions ?? payload.nextActions;
    if (Array.isArray(nextActions)) text = this.setNextActions(text, nextActions);
    return text;
  }

  private setTopLevelScalar(text: string, key: string, value: string): string {
    const line = `${key}: ${value}`;
    const pattern = new RegExp(`^${this.escapeRegex(key)}:\\s*.*$`, "m");
    return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
  }

  private setNextActions(text: string, actions: unknown[]): string {
    const rendered = [
      "next_actions:",
      ...actions.map((item) => {
        const action = typeof item === "string" ? item : this.readAction(item);
        const owner = typeof item === "string" ? "active-agent" : this.readOptionalString(item, "owner", "active-agent");
        const source = typeof item === "string" ? "updateContext" : this.readOptionalString(item, "source", "updateContext");
        return `  - action: ${action}\n    owner: ${owner}\n    source: ${source}`;
      })
    ].join("\n");
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => line.startsWith("next_actions:"));
    if (start === -1) return `${text.trimEnd()}\n${rendered}\n`;
    let end = start + 1;
    while (end < lines.length && (lines[end]?.startsWith(" ") || lines[end]?.trim() === "")) end += 1;
    return [...lines.slice(0, start), rendered, ...lines.slice(end)].join("\n");
  }

  private readAction(item: unknown): string {
    return this.readOptionalString(item, "action", "Continue");
  }

  private readOptionalString(item: unknown, key: string, fallback: string): string {
    return this.isRecord(item) && typeof item[key] === "string" ? item[key] : fallback;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private toSnakeCase(value: string): string {
    return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
