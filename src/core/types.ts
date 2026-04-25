export interface DetectionResult {
  found: boolean;
  root: string;
  contextDir: string | null;
  contextDirName: ".crewbee";
  reason: string;
}

export interface InitOptions {
  projectId?: string;
  projectName?: string;
  force?: boolean;
}

export interface InitResult {
  root: string;
  contextDir: string;
  created: string[];
  skipped: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checked: string[];
}

export interface PrimerOptions {
  budgetTokens?: number;
  memoryLimit?: number;
}

export interface ProjectContextPrimer {
  text: string;
  estimatedTokens: number;
  sourceFiles: string[];
  warnings: string[];
}

export type ContextBudget = "compact" | "normal" | "deep";

export interface PrepareContextRequest {
  goal: string;
  taskType?: string;
  budget?: ContextBudget;
}

export interface ProjectContextBrief {
  text: string;
  estimatedTokens: number;
  warnings: string[];
}

export interface ProjectContextSearchRequest {
  goal: string;
  budget?: ContextBudget;
}

export interface ContextSearchItem {
  source: string;
  title?: string;
  excerpt: string;
  score: number;
}

export interface ContextSearchResult {
  items: ContextSearchItem[];
}

export type ContextPatchTarget = "state" | "handoff" | "memory" | "decision";
export type ContextPatchOperation = "replace" | "append" | "merge";

export interface ContextPatch {
  target: ContextPatchTarget;
  operation?: ContextPatchOperation;
  payload: unknown;
  expectedHash?: string;
}

export interface ContextUpdateResult {
  ok: boolean;
  target: string;
  file: string;
  previousHash: string;
  nextHash: string;
  changed: boolean;
}

export interface SessionAction {
  action: string;
  owner?: string;
  source?: string;
}

export interface SessionSummary {
  title?: string;
  summary?: string;
  changedFiles?: string[];
  verification?: string[];
  nextActions?: Array<string | SessionAction>;
  blockers?: string[];
  memoryEntries?: Array<Record<string, string>>;
  decisions?: Array<Record<string, string>>;
}

export interface FinalizeResult {
  ok: boolean;
  checkpointId: string | null;
  changedFiles: string[];
  warnings: string[];
  doctor: ValidationResult;
  summary?: SessionSummary;
}

export interface CrewBeePromptFragment {
  enabled: boolean;
  text: string;
  sourceFiles: string[];
  warnings: string[];
}

export interface ParsedState {
  projectId: string | null;
  runStatus: string | null;
  activeCycle: string | null;
  activeStepId: string | null;
  lastCheckpoint: string | null;
  blockers: string[];
  nextActions: string[];
}

export interface ParsedPlan {
  projectId: string | null;
  cycleIds: string[];
  stepIds: string[];
}

export interface MemoryEntry {
  id: string | null;
  type: string | null;
  summary: string | null;
}
