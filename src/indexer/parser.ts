import type { MemoryEntry, ParsedPlan, ParsedState } from "../core/types.js";

export class ProjectContextParser {
  public readScalar(text: string, key: string): string | null {
    const match = text.match(new RegExp(`^${this.escapeRegex(key)}:\\s*(.+?)\\s*$`, "m"));
    return match?.[1] ? this.stripQuotes(match[1]) : null;
  }

  public parseState(text: string): ParsedState {
    return {
      projectId: this.readScalar(text, "project_id"),
      runStatus: this.readScalar(text, "run_status"),
      activeCycle: this.readScalar(text, "active_cycle"),
      activeStepId: this.readScalar(text, "active_step_id"),
      lastCheckpoint: this.readScalar(text, "last_checkpoint"),
      blockers: this.parseListSection(text, "blockers"),
      nextActions: this.parseActionItems(text)
    };
  }

  public parsePlan(text: string): ParsedPlan {
    return {
      projectId: this.readScalar(text, "project_id"),
      cycleIds: [...text.matchAll(/^\s{2}- id:\s*([^\s]+)\s*$/gm)].map((match) => match[1] ?? ""),
      stepIds: [...text.matchAll(/^\s{6}- id:\s*([^\s]+)\s*$/gm)].map((match) => match[1] ?? "")
    };
  }

  public parsePlanStepTitle(text: string, stepId: string): string | null {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index]?.trim() === `- id: ${stepId}`) {
        for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
          const match = lines[cursor]?.match(/^\s+title:\s*(.+)$/);
          if (match?.[1]) return this.stripQuotes(match[1]);
        }
      }
    }
    return null;
  }

  public parseMarkdownSectionItems(markdown: string, heading: string): string[] {
    const lines = markdown.split(/\r?\n/);
    const result: string[] = [];
    let inSection = false;
    for (const line of lines) {
      if (line.trim() === `## ${heading}`) {
        inSection = true;
        continue;
      }
      if (inSection && line.startsWith("## ")) break;
      const match = inSection ? line.match(/^\s*(?:\d+\.|-)\s+(.+)$/) : null;
      if (match?.[1]) result.push(match[1].trim());
    }
    return result;
  }

  public parseMarkdownSectionText(markdown: string, heading: string): string | null {
    const lines = markdown.split(/\r?\n/);
    const result: string[] = [];
    let inSection = false;
    for (const line of lines) {
      if (line.trim() === `## ${heading}`) {
        inSection = true;
        continue;
      }
      if (inSection && line.startsWith("## ")) break;
      if (inSection) result.push(line);
    }
    const text = result.join("\n").trim();
    return text.length > 0 ? text : null;
  }

  public parseMemoryEntries(text: string, limit = 5): MemoryEntry[] {
    return text
      .split(/\n(?=- ID:)/g)
      .map((block) => ({
        id: this.readBlockValue(block, "ID"),
        type: this.readBlockValue(block, "Type"),
        summary: this.readBlockValue(block, "Summary")
      }))
      .filter((entry) => entry.id !== null || entry.summary !== null)
      .slice(0, limit);
  }

  public stripQuotes(value: string): string {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  private parseListSection(text: string, key: string): string[] {
    const lines = text.split(/\r?\n/);
    const result: string[] = [];
    let inSection = false;
    for (const line of lines) {
      if (line.startsWith(`${key}:`)) {
        inSection = true;
        if (line.includes("[]")) return [];
        continue;
      }
      if (inSection && /^\S/.test(line)) break;
      const match = inSection ? line.match(/^\s+-\s+(.+)$/) : null;
      if (match?.[1]) result.push(this.stripQuotes(match[1]));
    }
    return result;
  }

  private parseActionItems(text: string): string[] {
    return [...text.matchAll(/^\s+- action:\s*(.+)$/gm)].map((match) => this.stripQuotes(match[1] ?? ""));
  }

  private readBlockValue(block: string, key: string): string | null {
    const match = block.match(new RegExp(`${key}:\\s*(.+)`));
    return match?.[1] ? this.stripQuotes(match[1].replace(/`/g, "").trim()) : null;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
