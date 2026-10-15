import { describe, expect, it } from 'vitest';
import {
  MAX_VERIFY_PER_LEAD, SCRAPE_UNITS, WORKER_RESOURCE, failureForStatus, parseScrapeReply, parseVerifyReply, readWorkerConfig,
  scrapeLine, scrapeTimeoutFor, shouldRefund, unconfirmedLabel, verifyAction, verifyTallyLine, workerFailureLine,
} from '../../supabase/functions/_shared/workerRules';

it.each([[39_000, null], [41_000, null], [42_000, 10_000], [60_000, 25_000], [100_000, 25_000]])('scrape budget at %i ms preserves downstream time', (left, expected) => {
  expect(scrapeTimeoutFor(left!)).toBe(expected);
});

describe('readWorkerConfig', () => {
  it('needs both values and an https address', () => {
    expect(readWorkerConfig('https://lookup.didreamlabs.com/', ' s3cret ')).toEqual({ url: 'https://lookup.didreamlabs.com', secret: 's3cret' });
    expect(readWorkerConfig(undefined, 'x')).toBeNull();
    expect(readWorkerConfig('https://a.example', '')).toBeNull();
    expect(readWorkerConfig('https://a.example', '   ')).toBeNull();
    expect(readWorkerConfig('http://a.example', 'x')).toBeNull();
    expect(readWorkerConfig('not a url', 'x')).toBeNull();
  });
});

describe('costs and mapping', () => {
  it('charges 3 units for a deep scrape and 1 otherwise', () => {
    expect(SCRAPE_UNITS).toEqual({ homepage: 1, key_pages: 1, deep: 3 });
    expect(WORKER_RESOURCE).toEqual({ scrape: 'worker_scrape', verify: 'worker_verify', fetch: 'worker_fetch' });
    expect(MAX_VERIFY_PER_LEAD).toBe(6);
  });
  it('maps http statuses to failures', () => {
    expect(failureForStatus(200)).toBeNull();
    expect(failureForStatus(204)).toBeNull();
    expect(failureForStatus(401)).toBe('not_configured');
    expect(failureForStatus(403)).toBe('not_configured');
    expect(failureForStatus(429)).toBe('busy');
    expect(failureForStatus(500)).toBe('unreachable');
    expect(failureForStatus(503)).toBe('unreachable');
    expect(failureForStatus(504)).toBe('unreachable');
    expect(failureForStatus(400)).toBe('bad_response');
    expect(failureForStatus(422)).toBe('bad_response');
  });
  it('refunds only when the worker did no work', () => {
    expect(shouldRefund('busy')).toBe(true);
    expect(shouldRefund('unreachable')).toBe(true);
    expect(shouldRefund('not_configured')).toBe(true);
    expect(shouldRefund('bad_response')).toBe(false);
    expect(shouldRefund('limit_reached')).toBe(false);
  });
});

describe('parseVerifyReply', () => {
  it('accepts a well-formed reply for the expected address', () => {
    expect(parseVerifyReply({ email: 'Max@LoveLiving.uk', status: 'valid', reason: 'deliverable' }, 'max@loveliving.uk'))
      .toEqual({ status: 'valid', reason: 'deliverable' });
  });
  it('keeps risky and unverifiable and never upgrades them', () => {
    expect(parseVerifyReply({ email: 'a@b.co', status: 'risky', reason: 'catch_all' }, 'a@b.co')).toEqual({ status: 'risky', reason: 'catch_all' });
    expect(parseVerifyReply({ email: 'a@b.co', status: 'unverifiable', reason: 'provider_blocks_checks' }, 'a@b.co')).toEqual({ status: 'unverifiable', reason: 'provider_blocks_checks' });
  });
  it('rejects a reply for another address, an unknown status or junk', () => {
    expect(parseVerifyReply({ email: 'other@b.co', status: 'valid', reason: 'deliverable' }, 'a@b.co')).toBeNull();
    expect(parseVerifyReply({ email: 'a@b.co', status: 'deliverable', reason: 'x' }, 'a@b.co')).toBeNull();
    expect(parseVerifyReply(null, 'a@b.co')).toBeNull();
    expect(parseVerifyReply('valid', 'a@b.co')).toBeNull();
  });
  it('turns an unknown reason into "unknown" instead of passing raw text through', () => {
    expect(parseVerifyReply({ email: 'a@b.co', status: 'risky', reason: 'smtp said: <script>' }, 'a@b.co')).toEqual({ status: 'risky', reason: 'unknown' });
  });
  it('refuses to call a catch-all result valid', () => {
    expect(parseVerifyReply({ email: 'a@b.co', status: 'valid', reason: 'catch_all' }, 'a@b.co')).toEqual({ status: 'risky', reason: 'catch_all' });
  });
});

describe('parseScrapeReply', () => {
  const reply = {
    domain: 'loveliving.uk',
    emails: [
      { value: 'Max@loveliving.uk', sources: ['https://loveliving.uk/team', 'http://evil.example/x'], is_likely_official: true },
      { value: 'david@loveliving.uk', sources: [] },
      { value: 'someone@other.com', sources: ['https://loveliving.uk/'] },
      { value: 'not an email' },
      { value: 'dup@loveliving.uk' }, { value: 'DUP@loveliving.uk' },
    ],
    phones: [{ value: '+44 20 7946 0958', sources: ['https://loveliving.uk/contact'] }, { value: '12', sources: [] }, { value: 'call me <b>', sources: [] }],
    error: 'scrape_incomplete',
  };
  it('keeps only addresses on the lead domain, lowercased, deduplicated, with a safe source', () => {
    const f = parseScrapeReply(reply, 'loveliving.uk')!;
    expect(f.emails).toEqual([
      { value: 'max@loveliving.uk', source: 'https://loveliving.uk/team' },
      { value: 'david@loveliving.uk', source: null },
      { value: 'dup@loveliving.uk', source: null },
    ]);
  });
  it('keeps plausible phone numbers only', () => {
    expect(parseScrapeReply(reply, 'loveliving.uk')!.phones).toEqual([{ value: '+44 20 7946 0958', source: 'https://loveliving.uk/contact' }]);
  });
  it('ignores addresses on a different domain (Review Focus 1)', () => {
    expect(parseScrapeReply({ emails: [{ value: 'x@other.com' }], phones: [] }, 'loveliving.uk')).toEqual({ emails: [], phones: [] });
  });
  it('caps sizes and tolerates missing arrays', () => {
    const many = { emails: Array.from({ length: 40 }, (_, i) => ({ value: `p${i}@a.co` })), phones: [] };
    expect(parseScrapeReply(many, 'a.co')!.emails).toHaveLength(10);
    expect(parseScrapeReply({}, 'a.co')).toEqual({ emails: [], phones: [] });
    expect(parseScrapeReply(null, 'a.co')).toBeNull();
    expect(parseScrapeReply([], 'a.co')).toBeNull();
  });
});

describe('verifyAction (Hunter only when the checker cannot decide)', () => {
  it('valid is accepted and invalid dropped, whatever Hunter has', () => {
    expect(verifyAction('valid', true)).toBe('accept');
    expect(verifyAction('valid', false)).toBe('accept');
    expect(verifyAction('invalid', true)).toBe('drop');
  });
  it('risky, unverifiable and a failed check ask Hunter when it is available, else become a suggestion', () => {
    for (const s of ['risky', 'unverifiable', null] as const) {
      expect(verifyAction(s, true)).toBe('ask_hunter');
      expect(verifyAction(s, false)).toBe('suggest');
    }
  });
});

describe('plain-English text', () => {
  it('explains an unconfirmed address', () => {
    expect(unconfirmedLabel('catch_all')).toBe('Built from the email format. The mail server accepts any address, so it cannot be confirmed, check it');
    expect(unconfirmedLabel('provider_blocks_checks')).toBe('Built from the email format. The mail provider does not allow checks, so it cannot be confirmed, check it');
    expect(unconfirmedLabel('whatever')).toBe('Built from the email format. Our email checker could not confirm it, check it');
  });
  it('words each failure without naming the worker address', () => {
    for (const f of ['not_configured', 'limit_reached', 'busy', 'unreachable', 'bad_response'] as const) {
      const line = workerFailureLine(f);
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toMatch(/https?:|didreamlabs|secret/i);
    }
    expect(workerFailureLine('not_configured')).toBe('The lookup worker is not set up, so it was not used.');
  });
  it('words the tally and the scrape result', () => {
    expect(verifyTallyLine({ checked: 0, valid: 0, invalid: 0, undecided: 0 })).toBeNull();
    expect(verifyTallyLine({ checked: 3, valid: 2, invalid: 0, undecided: 1 })).toBe('Checked 3 email addresses with our own checker (2 valid, 0 not real, 1 could not be confirmed).');
    expect(verifyTallyLine({ checked: 1, valid: 1, invalid: 0, undecided: 0 })).toBe('Checked 1 email address with our own checker (1 valid, 0 not real, 0 could not be confirmed).');
    expect(scrapeLine('loveliving.uk', { emails: [{ value: 'a@loveliving.uk', source: null }], phones: [] }))
      .toBe('Read loveliving.uk with the browser scraper: found 1 address and 0 phone numbers.');
  });
});
