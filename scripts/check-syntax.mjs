import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "dist", "coverage", "tmp"]);
const files = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) files.push(absolute);
  }
}

await walk(root);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax check passed for ${files.length} files.`);
