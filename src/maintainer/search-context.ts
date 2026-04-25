import path from "node:path";
import { SEARCHABLE_CONTEXT_FILES } from "../core/constants.js";
import type { ContextSearchItem, ContextSearchResult } from "../core/types.js";
import { FileSystemProjectContextStore } from "../workspace/workspace-store.js";

export class ContextSearcher {
  public constructor(private readonly store: FileSystemProjectContextStore) {}

  public async search(query: string, options: { limit?: number } = {}): Promise<ContextSearchResult> {
    if (!query.trim()) return { items: [] };
    const limit = options.limit ?? 10;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const contextDir = this.store.paths.contextDir();
    const files = [
      ...SEARCHABLE_CONTEXT_FILES.map((fileName) => path.join(contextDir, fileName)),
      ...(await this.store.listObservationFiles())
    ];
    const items: ContextSearchItem[] = [];
    for (const file of files) {
      if (!(await this.store.exists(file))) continue;
      const text = await this.store.readText(file);
      const lower = text.toLowerCase();
      const score = terms.reduce((sum, term) => sum + this.countOccurrences(lower, term), 0);
      if (score === 0) continue;
      const title = this.firstHeading(text);
      const item: ContextSearchItem = { source: this.store.paths.contextRelative(file), excerpt: this.excerpt(text, terms), score };
      if (title !== undefined) item.title = title;
      items.push(item);
    }
    items.sort((left, right) => right.score - left.score || left.source.localeCompare(right.source));
    return { items: items.slice(0, limit) };
  }

  private countOccurrences(text: string, term: string): number {
    let count = 0;
    let index = text.indexOf(term);
    while (index !== -1) {
      count += 1;
      index = text.indexOf(term, index + term.length);
    }
    return count;
  }

  private firstHeading(text: string): string | undefined {
    return text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  }

  private excerpt(text: string, terms: string[]): string {
    const lower = text.toLowerCase();
    const firstIndex = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
    return text.slice(Math.max(0, firstIndex - 100), Math.min(text.length, firstIndex + 220)).replace(/\s+/g, " ").trim();
  }
}
