import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, "src"), path.join(dist, "src"), { recursive: true });
await cp(path.join(root, "templates"), path.join(dist, "templates"), { recursive: true });
await writeFile(path.join(dist, "BUILD_INFO.json"), JSON.stringify({ builtAt: new Date().toISOString(), format: "esm" }, null, 2));

console.log("Build completed: dist/");
