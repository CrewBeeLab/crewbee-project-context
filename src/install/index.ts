export { findProjectContextPluginEntries, hasRecommendedPluginOrder, readOpenCodeConfig, upsertProjectContextPluginEntry, writeOpenCodeConfig } from "./config-writer.js";
export { runInstallDoctor } from "./doctor.js";
export { installProjectContext } from "./install.js";
export { resolveOpenCodeConfigPath, resolveOpenCodeConfigRoot, resolveInstallRoot } from "./install-root.js";
export { cleanupOpenCodePackageCaches } from "./package-manager.js";
export { createCanonicalPluginEntry, detectInstalledPackageRoot, PROJECT_CONTEXT_PACKAGE_NAME, PROJECT_CONTEXT_PLUGIN_CHANNEL, PROJECT_CONTEXT_PLUGIN_ENTRY } from "./plugin-entry.js";
export type { DoctorOptions, DoctorResult, InstallCommandContext, InstallCommandOptions, InstallResult, InstallSource } from "./types.js";
