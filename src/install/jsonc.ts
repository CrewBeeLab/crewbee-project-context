export function parseJsoncText(text: string): Record<string, unknown> {
  const normalized = stripTrailingCommas(stripJsonComments(text)).trim();
  if (normalized.length === 0) return {};

  const parsed = JSON.parse(normalized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenCode config must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function stripJsonComments(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index] ?? "";
    const next = text[index + 1];

    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        result += current;
      }
      continue;
    }

    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === "\\") {
        escaped = true;
        continue;
      }
      if (current === "\"") inString = false;
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    result += current;
  }

  return result;
}

function stripTrailingCommas(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index] ?? "";
    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === "\\") {
        escaped = true;
        continue;
      }
      if (current === "\"") inString = false;
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }

    if (current === "," && /[}\]]/.test(findNextNonWhitespaceCharacter(text, index + 1) ?? "")) {
      continue;
    }
    result += current;
  }

  return result;
}

function findNextNonWhitespaceCharacter(text: string, startIndex: number): string | undefined {
  for (let index = startIndex; index < text.length; index += 1) {
    const current = text[index];
    if (current && !/\s/.test(current)) return current;
  }
  return undefined;
}
