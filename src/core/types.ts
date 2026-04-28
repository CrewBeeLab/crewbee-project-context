export interface DetectionResult {
  found: boolean;
  root: string;
  contextDir: string | null;
  contextDirName: ".crewbee/.prjctxt";
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
  includeExtended?: boolean;
  includeProject?: boolean;
  goal?: string;
}

export interface ProjectContextPrimer {
  text: string;
  estimatedTokens: number;
  warnings: string[];
}

export type ContextBudget = "compact" | "normal";

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

export interface CrewBeePromptFragment {
  enabled: boolean;
  text: string;
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
