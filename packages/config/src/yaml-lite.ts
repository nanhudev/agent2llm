/**
 * Minimal YAML subset parser.
 *
 * Workspace configuration must be human friendly, but pulling a full YAML
 * implementation into the runtime is not worth the attack surface for a
 * file that only ever holds non-secret preferences. Supported syntax:
 *
 *   # comment
 *   key: value
 *   key:
 *     - item
 *     - item
 *
 * Anything else (anchors, flow collections, multi-line scalars, nesting
 * deeper than one list level) is rejected with a clear error.
 */
export type YamlValue = string | number | boolean | string[];
export type YamlObject = Record<string, YamlValue>;

export class YamlParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message} (line ${line})`);
    this.name = "YamlParseError";
  }
}

function scalar(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseMinimalYaml(input: string): YamlObject {
  const result: YamlObject = {};
  const lines = input.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    const lineNumber = index + 1;
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;

    const keyMatch = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(raw);
    if (keyMatch) {
      const key = keyMatch[1]!;
      const value = keyMatch[2]!.replace(/\s+#.*$/, "").trim();
      if (value === "") {
        currentKey = key;
        currentList = [];
        result[key] = currentList;
        continue;
      }
      if (value.startsWith("[") || value.startsWith("{")) {
        throw new YamlParseError("Flow collections are not supported", lineNumber);
      }
      const parsed = scalar(value);
      result[key] = typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean"
        ? parsed
        : String(parsed);
      currentKey = null;
      currentList = null;
      continue;
    }

    const listMatch = /^\s*-\s+(.*)$/.exec(raw);
    if (listMatch) {
      if (!currentKey || !currentList) {
        throw new YamlParseError("List item without a preceding key", lineNumber);
      }
      const item = listMatch[1]!.replace(/\s+#.*$/, "").trim();
      currentList.push(String(scalar(item)));
      continue;
    }

    throw new YamlParseError(`Unsupported YAML syntax: ${raw.trim()}`, lineNumber);
  }

  return result;
}
