export interface JsonObjectSpan { value: Record<string, unknown>; start: number; end: number }

/** Read bounded top-level objects from prose, JSON lines or arrays, preserving original offsets. */
export function jsonObjects(input: string): JsonObjectSpan[] {
  const source = input.slice(0, 64_000).replace(/^\s*```[^\r\n]*/gm, match => ' '.repeat(match.length));
  const found: JsonObjectSpan[] = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < source.length && found.length < 100; i++) {
    const char = source[i];
    if (start < 0) { if (char === '{') { start = i; depth = 1; } continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        const value: unknown = JSON.parse(source.slice(start, i + 1));
        if (value && typeof value === 'object' && !Array.isArray(value)) found.push({ value: value as Record<string, unknown>, start, end: i + 1 });
      } catch { /* Balanced malformed objects are skipped; later objects remain eligible. */ }
      start = -1;
    }
  }
  return found;
}
