import crypto from "node:crypto";
import { ProjectContextError } from "../core/errors.js";
import { FileSystemProjectContextStore } from "./workspace-store.js";

export class OptimisticFileWriter {
  public constructor(private readonly store: FileSystemProjectContextStore) {}

  public hashText(text: string): string {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
  }

  public async readWithHash(filePath: string): Promise<{ text: string; hash: string }> {
    const text = await this.store.readText(filePath);
    return { text, hash: this.hashText(text) };
  }

  public async writeIfHashMatches(filePath: string, text: string, expectedHash?: string): Promise<string> {
    const normalizedText = text.endsWith("\n") ? text : `${text}\n`;
    if (expectedHash) {
      if (!(await this.store.exists(filePath))) {
        throw new ProjectContextError("Cannot verify hash for missing file.", { filePath });
      }
      const current = await this.readWithHash(filePath);
      if (current.hash !== expectedHash) {
        throw new ProjectContextError("Refusing to overwrite context file because expectedHash does not match.", {
          filePath,
          expectedHash,
          actualHash: current.hash
        });
      }
    }
    await this.store.writeText(filePath, normalizedText);
    return this.hashText(normalizedText);
  }
}
