export class ProjectContextError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ProjectContextError";
    this.details = details;
  }
}

export class UnsafeContextPathError extends ProjectContextError {
  constructor(filePath) {
    super(`Refusing to access path outside project context: ${filePath}`, { filePath });
    this.name = "UnsafeContextPathError";
  }
}
