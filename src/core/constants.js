export const DEFAULT_CONTEXT_DIR = ".crewbee";

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
];

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
];

export const DEFAULT_READ_ORDER = [
  ".crewbee/HANDOFF.md",
  ".crewbee/STATE.yaml",
  ".crewbee/PLAN.yaml",
  ".crewbee/IMPLEMENTATION.md",
  ".crewbee/ARCHITECTURE.md"
];
