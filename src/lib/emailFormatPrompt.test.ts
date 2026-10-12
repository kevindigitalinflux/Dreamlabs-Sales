import { describe, expect, it } from 'vitest';
import { EMAIL_FORMAT_PROMPT_LINE } from '../../supabase/functions/_shared/emailFormatPrompt';
// The prompts live inside Deno modules that call external APIs, so their source text is checked instead.
import aiSource from '../../supabase/functions/_shared/ai.ts?raw';
import linkedinSource from '../../supabase/functions/draft-linkedin-message/index.ts?raw';

/** The source of one exported function in ai.ts, up to the next export. */
function fnSource(name: string): string {
  const start = aiSource.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = aiSource.indexOf('\nexport ', start + 1);
  return aiSource.slice(start, next === -1 ? undefined : next);
}

describe('EMAIL_FORMAT_PROMPT_LINE', () => {
  it('describes every marker and asks for no HTML or other markdown', () => {
    for (const marker of ['**bold**', "'- '", "'## '", '[text](https://url)']) expect(EMAIL_FORMAT_PROMPT_LINE).toContain(marker);
    expect(EMAIL_FORMAT_PROMPT_LINE).toContain('KEEP every bit of this formatting');
    expect(EMAIL_FORMAT_PROMPT_LINE).toContain('no HTML, no other markdown');
    expect(EMAIL_FORMAT_PROMPT_LINE).not.toMatch(/[—–]/);
  });
});

describe('email drafting prompts', () => {
  it('draftEmail uses the shared line and no longer asks for plain text', () => {
    const src = fnSource('draftEmail');
    expect(src).toContain('${EMAIL_FORMAT_PROMPT_LINE}');
    expect(src).not.toContain('Keep it plain text');
  });

  it('draftEmailClaude uses the shared line for email and keeps plain text only for LinkedIn', () => {
    const src = fnSource('draftEmailClaude');
    expect(src).toContain('EMAIL_FORMAT_PROMPT_LINE');
    expect(src).toMatch(/channel === 'linkedin'/);
  });

  it('the LinkedIn DM drafter asks for the LinkedIn channel', () => {
    expect(linkedinSource).toContain("channel: 'linkedin'");
  });
});
