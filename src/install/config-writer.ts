import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_CONTEXT_PLUGIN_ENTRY, PROJECT_CONTEXT_PACKAGE_NAME } from "./plugin-entry.js";
import { parseJsoncText } from "./jsonc.js";

export interface OpenCodeConfigDocument {
  config: Record<string, unknown>;
  existed: boolean;
  path: string;
}

export interface PluginUpdateResult {
  changed: boolean;
  migratedEntries: string[];
}

export function readOpenCodeConfig(configPath: string): OpenCodeConfigDocument {
  if (!existsSync(configPath)) return { config: {}, existed: false, path: configPath };
  return { config: parseJsoncText(readFileSync(configPath, "utf8")), existed: true, path: configPath };
}

export function writeOpenCodeConfig(configPath: string, config: Record<string, unknown>): void {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function upsertProjectContextPluginEntry(config: Record<string, unknown>, pluginEntry = PROJECT_CONTEXT_PLUGIN_ENTRY): PluginUpdateResult {
  const currentPlugins = getRawPluginArray(config);
  const migratedEntries: string[] = [];
  const withoutProjectContext: unknown[] = [];

  for (const value of currentPlugins) {
    if (typeof value === "string" && isProjectContextPluginReference(value)) {
      if (value !== pluginEntry) migratedEntries.push(value);
      continue;
    }
    withoutProjectContext.push(value);
  }

  const insertAfterIndex = findLastCrewBeeIndex(withoutProjectContext);
  const nextPlugins = [...withoutProjectContext];
  if (insertAfterIndex >= 0) nextPlugins.splice(insertAfterIndex + 1, 0, pluginEntry);
  else nextPlugins.push(pluginEntry);

  const changed = !arePluginArraysEqual(currentPlugins, nextPlugins) || migratedEntries.length > 0;
  config.plugin = nextPlugins;
  return { changed, migratedEntries };
}

export function findProjectContextPluginEntries(config: Record<string, unknown>): string[] {
  return getRawPluginArray(config).filter((value): value is string => typeof value === "string" && isProjectContextPluginReference(value));
}

export function hasRecommendedPluginOrder(config: Record<string, unknown>): boolean {
  const plugins = getRawPluginArray(config);
  const crewBeeIndex = plugins.findIndex((value) => typeof value === "string" && isCrewBeePluginReference(value));
  const projectContextIndex = plugins.findIndex((value) => typeof value === "string" && isProjectContextPluginReference(value));
  if (projectContextIndex < 0) return false;
  return crewBeeIndex < 0 || crewBeeIndex < projectContextIndex;
}

function getRawPluginArray(config: Record<string, unknown>): unknown[] {
  return Array.isArray(config.plugin) ? [...config.plugin] : [];
}

function findLastCrewBeeIndex(values: unknown[]): number {
  let result = -1;
  values.forEach((value, index) => {
    if (typeof value === "string" && isCrewBeePluginReference(value)) result = index;
  });
  return result;
}

function arePluginArraysEqual(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isProjectContextPluginReference(value: string): boolean {
  if (value === PROJECT_CONTEXT_PACKAGE_NAME || value.startsWith(`${PROJECT_CONTEXT_PACKAGE_NAME}@`)) return true;
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  return normalized.includes(`/node_modules/${PROJECT_CONTEXT_PACKAGE_NAME}/`) || normalized.endsWith(`/${PROJECT_CONTEXT_PACKAGE_NAME}/opencode-plugin.mjs`);
}

function isCrewBeePluginReference(value: string): boolean {
  if (value === "crewbee" || value.startsWith("crewbee@")) return true;
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/node_modules/crewbee/") || normalized.endsWith("/entry/crewbee-opencode-entry.mjs");
}
