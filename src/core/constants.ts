export const DEFAULT_CONTEXT_DIR = ".crewbee/.prjctxt";
export const PRIVATE_RUNTIME_CONTEXT_DIR = DEFAULT_CONTEXT_DIR;
export const LEGACY_CONTEXT_DIR = ".crewbeectxt";

export const REQUIRED_CONTEXT_FILES = [
  "QUICKSTART.md",
  "PROJECT.md",
  "ARCHITECTURE.md",
  "IMPLEMENTATION.md",
  "PLAN.yaml",
  "STATE.yaml",
  "HANDOFF.md",
  "MEMORY_INDEX.md",
  "DECISIONS.md",
  "REFERENCES.md",
  "config.yaml"
] as const;

export const SEARCHABLE_CONTEXT_FILES = [
  "PROJECT.md",
  "ARCHITECTURE.md",
  "IMPLEMENTATION.md",
  "PLAN.yaml",
  "STATE.yaml",
  "HANDOFF.md",
  "MEMORY_INDEX.md",
  "DECISIONS.md",
  "REFERENCES.md"
] as const;
