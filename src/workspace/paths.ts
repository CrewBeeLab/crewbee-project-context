import path from "node:path";
import { DEFAULT_CONTEXT_DIR } from "../core/constants.js";
import { UnsafeContextPathError } from "../core/errors.js";

export class ProjectContextPaths {
  public readonly root: string;

  public constructor(root: string = process.cwd()) {
    this.root = path.resolve(root);
  }

  public contextDir(): string {
    return path.join(this.root, DEFAULT_CONTEXT_DIR);
  }

  public contextFile(requestedPath: string): string {
    const normalizedRequest = requestedPath.replaceAll("\\", "/");
    const withoutPrefix = normalizedRequest.startsWith(`${DEFAULT_CONTEXT_DIR}/`)
      ? normalizedRequest.slice(DEFAULT_CONTEXT_DIR.length + 1)
      : normalizedRequest;
    const resolved = path.resolve(this.contextDir(), withoutPrefix);
    this.assertInside(resolved, this.contextDir());
    return resolved;
  }

  public contextRelative(absolutePath: string): string {
    const relative = path.relative(this.root, absolutePath).replaceAll("\\", "/");
    return relative.startsWith(DEFAULT_CONTEXT_DIR) ? relative : `${DEFAULT_CONTEXT_DIR}/${relative}`;
  }

  private assertInside(candidatePath: string, parentPath: string): void {
    const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new UnsafeContextPathError(candidatePath);
    }
  }
}
