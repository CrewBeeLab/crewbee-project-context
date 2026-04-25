export interface DetectionResult {
  found: boolean;
  root: string;
  contextDir: string | null;
  contextDirName: string;
  reason: string;
}

export interface InitOptions {
  contextDir?: string;
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

export interface MigrateOptions {
  from?: string;
  to?: string;
  force?: boolean;
  removeSource?: boolean;
}

export interface MigrateResult {
  root: string;
  sourceDir: string;
  targetDir: string;
  copied: boolean;
  removedSource: boolean;
  rewrittenFiles: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checked: string[];
}

export interface PrimerOptions {
  contextDir?: string;
  budgetTokens?: number;
  memoryLimit?: number;
}

export interface ProjectContextPrimer {
  text: string;
  estimatedTokens: number;
  sourceFiles: string[];
  warnings: string[];
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

export interface ContextPatch {
  target: "state" | "handoff" | "memory" | "decision";
  operation?: "replace" | "append" | "merge";
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

export interface SessionSummary {
  title?: string;
  summary?: string;
  changedFiles?: string[];
  verification?: string[];
  nextActions?: Array<string | { action: string; owner?: string; source?: string }>;
  blockers?: string[];
  memoryEntries?: Array<Record<string, string>>;
  decisions?: Array<Record<string, string>>;
}

export const DEFAULT_CONTEXT_DIR: string;
export const REQUIRED_CONTEXT_FILES: string[];
export const SEARCHABLE_CONTEXT_FILES: string[];

export class ProjectContextError extends Error {
  details: Record<string, unknown>;
}

export class UnsafeContextPathError extends ProjectContextError {}

export function detect(root?: string, options?: { contextDir?: string }): Promise<DetectionResult>;
export function initProjectContext(root?: string, options?: InitOptions): Promise<InitResult>;
export function migrateProjectContext(root?: string, options?: MigrateOptions): Promise<MigrateResult>;
export function validateContext(root?: string, options?: { contextDir?: string }): Promise<ValidationResult>;
export function buildPrimer(root?: string, options?: PrimerOptions): Promise<ProjectContextPrimer>;
export function estimateTokens(text: string): number;
export function searchContext(root: string | undefined, query: string, options?: { contextDir?: string; limit?: number }): Promise<ContextSearchResult>;
export function readContextFile(root: string | undefined, requestedPath: string, options?: { contextDir?: string }): Promise<{ path: string; text: string }>;
export function updateContext(root: string | undefined, patch: ContextPatch, options?: { contextDir?: string }): Promise<ContextUpdateResult>;
export function finalizeSession(root?: string, summary?: SessionSummary, options?: { contextDir?: string }): Promise<{ ok: boolean; checkpointId: string | null; changedFiles: string[]; warnings: string[]; summary?: SessionSummary }>;
export function buildCrewBeePromptFragment(root?: string, options?: PrimerOptions): Promise<{ enabled: boolean; text: string; sourceFiles: string[]; warnings: string[] }>;
export function getCrewBeeToolNames(): string[];
export function executeCrewBeeProjectContextTool(root: string | undefined, name: string, input?: Record<string, unknown>, options?: { contextDir?: string }): Promise<unknown>;
