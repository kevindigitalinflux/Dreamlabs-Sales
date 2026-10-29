/** Existing ICP line/bullet cleaning, shared by template fallback and the tailored picker. */
export function icpPainPointLines(text: string | null | undefined): string[] {
  return (text ?? '').split('\n').map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
}
