export class ProjectContextError extends Error {
  public readonly details: Record<string, unknown>;

  public constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ProjectContextError";
    this.details = details;
  }
}

export class UnsafeContextPathError extends ProjectContextError {
  public constructor(filePath: string) {
    super(`Refusing to access path outside project context: ${filePath}`, { filePath });
    this.name = "UnsafeContextPathError";
  }
}
