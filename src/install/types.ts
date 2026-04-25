export type InstallSource = "local" | "registry";

export interface InstallCommandOptions {
  configPath?: string;
  dryRun: boolean;
  installRoot?: string;
  localTarballPath?: string;
  source: InstallSource;
}

export interface InstallCommandContext {
  cwd: string;
  packageRoot: string;
}

export interface InstallResult {
  configChanged: boolean;
  configPath: string;
  dryRun: boolean;
  installRoot: string;
  migratedEntries: string[];
  packageSpec?: string;
  pluginEntry: string;
  source: InstallSource;
  tarballPath?: string;
  workspaceCreated: boolean;
}

export interface DoctorOptions {
  configPath?: string;
  installRoot?: string;
}

export interface DoctorResult {
  configPath: string;
  configMatchesCanonical: boolean;
  currentPluginEntries: string[];
  expectedPluginEntry: string;
  hasHiddenMaintainerAgent: boolean;
  hasInstalledPackage: boolean;
  hasPluginFile: boolean;
  hasRecommendedPluginOrder: boolean;
  hasThreeToolSurface: boolean;
  hasWorkspaceManifest: boolean;
  healthy: boolean;
  installedPackageRoot: string;
  installRoot: string;
  maintainerTaskDeniedForPrimaryAgent: boolean;
  noCompactionHook: boolean;
  noProjectContextReadTool: boolean;
}
