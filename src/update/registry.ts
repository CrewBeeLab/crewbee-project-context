import type { ProjectContextReleaseIntent } from "./types.js";

export async function fetchTargetVersion(input: { intent: ProjectContextReleaseIntent; fetchJson(url: string): Promise<unknown> }): Promise<string | undefined> {
  const payload = await input.fetchJson(`https://registry.npmjs.org/${input.intent.packageName}`).catch(() => undefined);
  if (!payload || typeof payload !== "object") return undefined;
  const distTags = "dist-tags" in payload && typeof payload["dist-tags"] === "object" && payload["dist-tags"] !== null
    ? payload["dist-tags"] as Record<string, unknown>
    : undefined;
  const candidate = distTags?.[input.intent.channel];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
}
