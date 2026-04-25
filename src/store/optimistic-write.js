import crypto from "node:crypto";
import { ProjectContextError } from "../core/errors.js";
import { pathExists, readText, writeText } from "./file-system-store.js";

export function hashText(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export async function readWithHash(filePath) {
  const text = await readText(filePath);
  return {
    text,
    hash: hashText(text)
  };
}

export async function writeIfHashMatches(filePath, text, expectedHash) {
  if (expectedHash) {
    if (!(await pathExists(filePath))) {
      throw new ProjectContextError("Cannot verify hash for missing file.", { filePath });
    }
    const current = await readWithHash(filePath);
    if (current.hash !== expectedHash) {
      throw new ProjectContextError("Refusing to overwrite context file because expectedHash does not match.", {
        filePath,
        expectedHash,
        actualHash: current.hash
      });
    }
  }
  await writeText(filePath, text.endsWith("\n") ? text : `${text}\n`);
  return hashText(text.endsWith("\n") ? text : `${text}\n`);
}
