import path from "node:path";
import { DEFAULT_CONTEXT_DIR, SEARCHABLE_CONTEXT_FILES } from "../core/constants.js";
import { getContextDir, toContextRelative } from "../core/path.js";
import { listObservationFiles, pathExists, readText } from "../store/file-system-store.js";

export async function searchContext(root = process.cwd(), query, options = {}) {
  if (!query || !query.trim()) {
    return { items: [] };
  }
  const contextDir = options.contextDir ?? DEFAULT_CONTEXT_DIR;
  const limit = Number(options.limit ?? 10);
  const absoluteContextDir = getContextDir(root, contextDir);
  const files = [
    ...SEARCHABLE_CONTEXT_FILES.map((fileName) => path.join(absoluteContextDir, fileName)),
    ...(await listObservationFiles(root, { contextDir }))
  ];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const items = [];

  for (const file of files) {
    if (!(await pathExists(file))) continue;
    const text = await readText(file);
    const lower = text.toLowerCase();
    const score = terms.reduce((sum, term) => sum + countOccurrences(lower, term), 0);
    if (score === 0) continue;
    items.push({
      source: toContextRelative(root, file, contextDir),
      title: firstHeading(text),
      excerpt: excerpt(text, terms),
      score
    });
  }

  items.sort((left, right) => right.score - left.score || left.source.localeCompare(right.source));
  return { items: items.slice(0, limit) };
}

function countOccurrences(text, term) {
  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

function firstHeading(text) {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function excerpt(text, terms) {
  const lower = text.toLowerCase();
  const firstIndex = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstIndex - 100);
  const end = Math.min(text.length, firstIndex + 220);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
