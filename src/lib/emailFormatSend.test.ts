import { describe, expect, it } from 'vitest';
import { buildMailContent } from '../../supabase/functions/_shared/emailFormat';

const UNSUB = 'click here to unsubscribe: https://sales.example.com/unsubscribe/abc';

describe('buildMailContent', () => {
  it('sends a body with no markers exactly as written, with no HTML part', () => {
    const body = `Hi Jo,\n\nA well-known firm, 2 - 3 days. See https://example.com.\n\n${UNSUB}`;
    expect(buildMailContent(body)).toEqual({ content: body });
  });

  it('sends a formatted body as plain text plus HTML', () => {
    const body = `Hi **Jo**,\n\n- one\n- two\n\n${UNSUB}`;
    const out = buildMailContent(body);
    expect(out.content).toBe(`Hi Jo,\n\n- one\n- two\n\n${UNSUB}`);
    expect(out.html).toContain('<strong>Jo</strong>');
    expect(out.html).toContain('<ul');
  });

  it('keeps the unsubscribe URL in both parts', () => {
    const out = buildMailContent(`## Hello\n\n${UNSUB}`);
    expect(out.content).toContain('https://sales.example.com/unsubscribe/abc');
    expect(out.html).toContain('href="https://sales.example.com/unsubscribe/abc"');
  });
});
