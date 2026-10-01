import { describe, expect, it } from 'vitest';
import { appendLinkToBody, formatBytes, linksBlock, normalizeLinkUrl, validateAttachmentFile, validateVideoFile, MAX_TOTAL_ATTACHMENT_BYTES, MAX_VIDEO_BYTES } from './emailAttachments';

describe('validateAttachmentFile', () => {
  it('accepts PDF/PNG/JPEG within the total limit', () => {
    expect(validateAttachmentFile({ name: 'a.pdf', type: 'application/pdf', size: 1000 }, 0)).toBeNull();
    expect(validateAttachmentFile({ name: 'a.png', type: 'image/png', size: 1000 }, 0)).toBeNull();
    expect(validateAttachmentFile({ name: 'a.jpg', type: 'image/jpeg', size: 1000 }, 0)).toBeNull();
  });

  it('rejects other types and anything that would push the total over 10 MB', () => {
    expect(validateAttachmentFile({ name: 'a.exe', type: 'application/x-msdownload', size: 10 }, 0)).toMatch(/only PDF, PNG and JPEG/);
    expect(validateAttachmentFile({ name: 'a.gif', type: 'image/gif', size: 10 }, 0)).toMatch(/only PDF, PNG and JPEG/);
    expect(validateAttachmentFile({ name: 'big.pdf', type: 'application/pdf', size: 6 * 1024 * 1024 }, 5 * 1024 * 1024)).toMatch(/too big/);
    expect(validateAttachmentFile({ name: 'ok.pdf', type: 'application/pdf', size: 1024 }, MAX_TOTAL_ATTACHMENT_BYTES - 1024)).toBeNull();
  });
});

describe('validateVideoFile', () => {
  it('accepts mp4/mov/webm up to 50 MB and points bigger ones to a pasted link', () => {
    expect(validateVideoFile({ name: 'v.mp4', type: 'video/mp4', size: 1000 })).toBeNull();
    expect(validateVideoFile({ name: 'v.mov', type: 'video/quicktime', size: 1000 })).toBeNull();
    expect(validateVideoFile({ name: 'v.avi', type: 'video/x-msvideo', size: 1000 })).toMatch(/MP4, MOV and WebM/);
    expect(validateVideoFile({ name: 'v.mp4', type: 'video/mp4', size: MAX_VIDEO_BYTES + 1 })).toMatch(/YouTube/);
  });
});

describe('normalizeLinkUrl', () => {
  it('accepts http(s), adds https:// to a bare domain, and rejects other schemes and junk', () => {
    expect(normalizeLinkUrl('https://youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(normalizeLinkUrl('  example.com/prices ')).toBe('https://example.com/prices');
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('ftp://files.example.com/x')).toBeNull();
    expect(normalizeLinkUrl('')).toBeNull();
    expect(normalizeLinkUrl('not a url')).toBeNull();
  });
});

describe('linksBlock / formatBytes', () => {
  it('formats the links block the way the server appends it', () => {
    expect(linksBlock([{ label: 'Price list video', url: 'https://v.com/a' }, { label: 'https://x.com', url: 'https://x.com' }]))
      .toBe('Links:\nPrice list video: https://v.com/a\nhttps://x.com');
    expect(linksBlock([])).toBe('');
  });

  it('formats byte counts', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(10)).toBe('1 KB');
  });
});

describe('appendLinkToBody', () => {
  it('starts a Links block, and later links join it', () => {
    const first = appendLinkToBody('Hi Sam,\n\nThanks,\nKevin', { label: 'Price list', url: 'https://x.com/p.pdf' });
    expect(first).toBe('Hi Sam,\n\nThanks,\nKevin\n\nLinks:\nPrice list: https://x.com/p.pdf');
    expect(appendLinkToBody(first, { label: 'Intro video', url: 'https://youtu.be/a' }))
      .toBe('Hi Sam,\n\nThanks,\nKevin\n\nLinks:\nPrice list: https://x.com/p.pdf\nIntro video: https://youtu.be/a');
  });

  it('starts a new block when text follows an earlier Links block, and handles an empty body and bare URLs', () => {
    expect(appendLinkToBody('Links:\nA: https://a.com\n\nThanks', { label: 'B', url: 'https://b.com' })).toBe('Links:\nA: https://a.com\n\nThanks\n\nLinks:\nB: https://b.com');
    expect(appendLinkToBody('', { label: 'https://a.com', url: 'https://a.com' })).toBe('Links:\nhttps://a.com');
  });
});
