export interface ProjectContextReleaseIntent {
  configPath: string;
  entry: string;
  packageName: string;
  requestedVersion: string;
  channel: string;
  isPinned: boolean;
  workspaceRoot: string;
}

export interface ProjectContextReleaseCheckResult {
  currentVersion?: string | undefined;
  latestVersion?: string | undefined;
  needsRefresh: boolean;
  reason: "plugin-not-configured" | "pinned-version" | "latest-unavailable" | "up-to-date" | "refresh-required";
}

export interface ProjectContextReleaseRefreshDependencies {
  fetchJson(url: string): Promise<unknown>;
  runInstall(workspaceRoot: string): Promise<boolean>;
}
