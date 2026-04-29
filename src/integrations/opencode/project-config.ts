import { readFile } from "node:fs/promises";
import path from "node:path";

export const CREWBEE_PROJECT_CONFIG_PATH = path.join(".crewbee", "crewbee.json");

export interface ProjectContextEnabledResult {
  enabled: boolean;
  configPath: string;
  error?: string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readEnabledFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const record = asRecord(value);
  if (!record) return undefined;
  return typeof record.enabled === "boolean" ? record.enabled : undefined;
}

export function projectContextEnabledFromConfig(config: unknown): boolean {
  const root = asRecord(config);
  if (!root) return true;
  const candidates = [
    root["crewbee-project-context"],
    root.crewbeeProjectContext,
    root.projectContext,
    root.project_context
  ];
  for (const candidate of candidates) {
    const enabled = readEnabledFlag(candidate);
    if (enabled !== undefined) return enabled;
  }
  return true;
}

export async function readProjectContextEnabled(projectRoot: string): Promise<ProjectContextEnabledResult> {
  const configPath = path.join(projectRoot, CREWBEE_PROJECT_CONFIG_PATH);
  try {
    const config = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    return { enabled: projectContextEnabledFromConfig(config), configPath: CREWBEE_PROJECT_CONFIG_PATH };
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code === "ENOENT") return { enabled: true, configPath: CREWBEE_PROJECT_CONFIG_PATH };
    return { enabled: true, configPath: CREWBEE_PROJECT_CONFIG_PATH, error: error instanceof Error ? error.message : String(error) };
  }
}
