import { describe, expect, it } from 'vitest';
import {
  activeFormats,
  insertLink,
  normaliseLinkUrl,
  toggleBold,
  toggleBullets,
  toggleHeading,
} from './emailFormatEdit';

/** Helper: the selected text of a result. */
const sel = (r: { text: string; selStart: number; selEnd: number }) => r.text.slice(r.selStart, r.selEnd);

describe('toggleBold', () => {
  it('wraps the selection and keeps the same text selected', () => {
    const r = toggleBold('Hello world', 6, 11);
    expect(r.text).toBe('Hello **world**');
    expect(sel(r)).toBe('world');
  });
  it('unwraps when the markers are just outside the selection', () => {
    const r = toggleBold('Hello **world**', 8, 13);
    expect(r.text).toBe('Hello world');
    expect(sel(r)).toBe('world');
  });
  it('unwraps when the markers are inside the selection', () => {
    const r = toggleBold('Hello **world**', 6, 15);
    expect(r.text).toBe('Hello world');
    expect(sel(r)).toBe('world');
  });
  it('trims spaces off the selection before wrapping', () => {
    expect(toggleBold('Hello world ', 5, 12).text).toBe('Hello **world** ');
  });
  it('selects the word under the cursor', () => {
    const r = toggleBold('Hello world', 8, 8);
    expect(r.text).toBe('Hello **world**');
    expect(sel(r)).toBe('world');
  });
  it('unbolds the word under the cursor', () => {
    expect(toggleBold('Hello **world**', 10, 10).text).toBe('Hello world');
  });
  it('inserts **** with the cursor between when there is no word', () => {
    const r = toggleBold('Hello ', 6, 6);
    expect(r.text).toBe('Hello ****');
    expect(r.selStart).toBe(8);
    expect(r.selEnd).toBe(8);
  });
  it('wraps each line separately for a multi-line selection', () => {
    const r = toggleBold('one\ntwo', 0, 7);
    expect(r.text).toBe('**one**\n**two**');
    expect(toggleBold(r.text, r.selStart, r.selEnd).text).toBe('one\ntwo');
  });
  it('does not mutate the input', () => {
    const input = 'abc';
    toggleBold(input, 0, 3);
    expect(input).toBe('abc');
  });
});

describe('toggleBullets', () => {
  it('adds bullets to every touched line, skipping empty lines', () => {
    const r = toggleBullets('one\n\ntwo', 0, 8);
    expect(r.text).toBe('- one\n\n- two');
    expect(sel(r)).toBe('one\n\n- two');
  });
  it('removes bullets when all touched lines have them', () => {
    expect(toggleBullets('- one\n- two', 0, 11).text).toBe('one\ntwo');
  });
  it('adds to the lines missing a bullet when lines are mixed', () => {
    expect(toggleBullets('- one\ntwo', 0, 9).text).toBe('- one\n- two');
  });
  it('acts on the cursor line with an empty selection', () => {
    const r = toggleBullets('a\nbc\nd', 3, 3);
    expect(r.text).toBe('a\n- bc\nd');
    expect(r.selStart).toBe(5);
  });
  it('does not include the next line when the selection ends at its start', () => {
    expect(toggleBullets('one\ntwo', 0, 4).text).toBe('- one\ntwo');
  });
  it('replaces a heading with a bullet', () => {
    expect(toggleBullets('## Title', 3, 3).text).toBe('- Title');
  });
});

describe('toggleHeading', () => {
  it('adds and removes the heading prefix', () => {
    const on = toggleHeading('Title', 0, 5);
    expect(on.text).toBe('## Title');
    expect(sel(on)).toBe('Title');
    expect(toggleHeading(on.text, on.selStart, on.selEnd).text).toBe('Title');
  });
  it('replaces a bullet with a heading', () => {
    expect(toggleHeading('- Title', 4, 4).text).toBe('## Title');
  });
});

describe('insertLink', () => {
  it('wraps the selection as a link', () => {
    const r = insertLink('See our site now', 4, 12, 'https://example.com');
    expect(r.text).toBe('See [our site](https://example.com) now');
    expect(sel(r)).toBe('our site');
  });
  it('inserts [url](url) with no selection and puts the cursor after it', () => {
    const r = insertLink('See ', 4, 4, 'https://example.com');
    expect(r.text).toBe('See [https://example.com](https://example.com)');
    expect(r.selStart).toBe(r.text.length);
    expect(r.selEnd).toBe(r.text.length);
  });
  it('inserts after the selection when the selection cannot be link text', () => {
    expect(insertLink('a\nb', 0, 3, 'https://e.com').text).toBe('a\nb[https://e.com](https://e.com)');
  });
});

describe('activeFormats', () => {
  it('reports bold inside a bold span', () => {
    expect(activeFormats('a **bold** c', 5, 5).bold).toBe(true);
    expect(activeFormats('a **bold** c', 1, 1).bold).toBe(false);
  });
  it('reports bullets and headings on the touched lines', () => {
    expect(activeFormats('- a\n- b', 0, 7)).toEqual({ bold: false, bullets: true, heading: false });
    expect(activeFormats('- a\nb', 0, 5).bullets).toBe(false);
    expect(activeFormats('## Hi', 4, 4)).toEqual({ bold: false, bullets: false, heading: true });
  });
});

describe('normaliseLinkUrl', () => {
  it('adds https:// when the scheme is missing', () => {
    expect(normaliseLinkUrl('  example.com ')).toBe('https://example.com');
    expect(normaliseLinkUrl('example.com:8080/x')).toBe('https://example.com:8080/x');
  });
  it('keeps http(s) URLs', () => {
    expect(normaliseLinkUrl('http://a.co.uk/x')).toBe('http://a.co.uk/x');
  });
  it('rejects unsafe or invalid URLs', () => {
    expect(normaliseLinkUrl('javascript:x')).toBeNull();
    expect(normaliseLinkUrl('mailto:a@b.com')).toBeNull();
    expect(normaliseLinkUrl('')).toBeNull();
    expect(normaliseLinkUrl('not a url')).toBeNull();
    expect(normaliseLinkUrl('localhost')).toBeNull();
  });
});
