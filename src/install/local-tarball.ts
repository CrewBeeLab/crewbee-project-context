import { existsSync } from "node:fs";
import path from "node:path";

export function resolveLocalTarballPath(input: { localTarballPath?: string; searchRoots: string[] }): string {
  const candidates = input.localTarballPath
    ? [path.resolve(input.localTarballPath)]
    : input.searchRoots.map((root) => path.join(root, ".artifacts", "local", "crewbee-project-context-local.tgz"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Local crewbee-project-context tarball not found. Checked: ${candidates.join(", ")}`);
}
