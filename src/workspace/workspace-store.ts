import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "../core/constants.js";
import { ProjectContextPaths } from "./paths.js";
import type { DetectionResult } from "../core/types.js";

export class FileSystemProjectContextStore {
  public readonly paths: ProjectContextPaths;

  public constructor(root: string = process.cwd()) {
    this.paths = new ProjectContextPaths(root);
  }

  public async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  public async readText(filePath: string | URL): Promise<string> {
    return fs.readFile(filePath, "utf8");
  }

  public async writeText(filePath: string, text: string): Promise<void> {
    await this.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  }

  public async detect(): Promise<DetectionResult> {
    const contextDir = this.paths.contextDir();
    const found = await this.exists(contextDir);
    return {
      found,
      root: this.paths.root,
      contextDir: found ? contextDir : null,
      contextDirName: DEFAULT_CONTEXT_DIR,
      reason: found ? "context directory exists" : "context directory not found"
    };
  }

  public async readContextFile(requestedPath: string): Promise<{ path: string; text: string }> {
    const absolutePath = this.paths.contextFile(requestedPath);
    return { path: absolutePath, text: await this.readText(absolutePath) };
  }

  public async listObservationFiles(): Promise<string[]> {
    const observationsDir = this.paths.contextFile("observations");
    if (!(await this.exists(observationsDir))) return [];
    const entries = await fs.readdir(observationsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(observationsDir, entry.name));
  }
}
