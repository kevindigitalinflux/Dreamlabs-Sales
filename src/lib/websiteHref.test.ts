import { expect, it } from 'vitest';
import { websiteHref } from './websiteHref';

it.each([
  [' ux-tree.com ', 'https://ux-tree.com/'], ['HTTP://Example.com/a?q=1', 'http://example.com/a?q=1'],
  ['https://example.com', 'https://example.com/'], ['www.example.co.uk/team', 'https://www.example.co.uk/team'],
  ['example.com:8443/team', 'https://example.com:8443/team'],
])('turns %s into an external website link', (value, expected) => expect(websiteHref(value)).toBe(expected));
it.each([null, undefined, '', ' ', 'junk', '/pipeline', '//evil.com', 'javascript:alert(1)', 'data:text/html,x',
  'mailto:a@example.com', 'ftp://example.com', 'https://', 'hello world.com', 'https://user:pass@example.com',
  'https://example..com', 'https://-example.com', 'https://example.com\\evil', 'https://example.com\n/x'])('rejects unusable value %j', (value) => expect(websiteHref(value)).toBeNull());
