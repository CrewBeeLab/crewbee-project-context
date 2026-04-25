import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const result = spawnSync(process.execPath, [tsc], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
await cp(path.join(root, "templates"), path.join(dist, "templates"), { recursive: true });
await writeFile(path.join(dist, "opencode-plugin.mjs"), "export { default, server, ProjectContextOpenCodePlugin } from './src/integrations/opencode/plugin.js';\n");
await writeFile(path.join(dist, "BUILD_INFO.json"), JSON.stringify({ builtAt: new Date().toISOString(), format: "esm" }, null, 2));

console.log("Build completed: dist/");
