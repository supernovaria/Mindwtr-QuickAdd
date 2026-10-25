import { describe, expect, test } from 'vitest';
import { appendLink, linkLabel, singleHttpUrl } from './clipboard-link';
import { parseCapture } from '../parser';

describe('singleHttpUrl', () => {
  test('one http(s) URL, trimmed', () => {
    expect(singleHttpUrl('  https://example.com/a?b=1 \n')).toBe('https://example.com/a?b=1');
    expect(singleHttpUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });
  test('anything else is null', () => {
    expect(singleHttpUrl('')).toBeNull();
    expect(singleHttpUrl('see https://example.com')).toBeNull();
    expect(singleHttpUrl('https://a.com https://b.com')).toBeNull();
    expect(singleHttpUrl('ftp://example.com/file')).toBeNull();
    expect(singleHttpUrl('mailto:me@example.com')).toBeNull();
    expect(singleHttpUrl('example.com')).toBeNull();
    expect(singleHttpUrl('https://')).toBeNull();
    expect(singleHttpUrl(`https://example.com/${'x'.repeat(3000)}`)).toBeNull();
  });
});

describe('linkLabel', () => {
  test('host plus path, without www or a trailing slash', () => {
    expect(linkLabel('https://www.example.com/')).toBe('example.com');
    expect(linkLabel('https://example.com/docs/intro/?q=1#top')).toBe('example.com/docs/intro');
    expect(linkLabel('https://de.wikipedia.org/wiki/K%C3%A4se')).toBe('de.wikipedia.org/wiki/Käse');
  });
  test('long paths are cut', () => {
    const label = linkLabel('https://github.com/mindwtr/mindwtr/issues/1234/comments/5678');
    expect(label).toBe('github.com/mindwtr/mindwtr/issues/1…');
    expect(label.length).toBeLessThanOrEqual(36);
  });
});

describe('appendLink', () => {
  test('appends after a space and selects the label', () => {
    const result = appendLink('Read this ', 'https://example.com/post');
    expect(result.text).toBe('Read this [example.com/post](https://example.com/post)');
    expect(result.text.slice(...result.selection)).toBe('example.com/post');
  });
  test('into an empty input', () => {
    const result = appendLink('', 'https://example.com');
    expect(result.text).toBe('[example.com](https://example.com)');
    expect(result.selection).toEqual([1, 12]);
  });
  test('the parser makes it a link attachment and keeps the label in the title', () => {
    const { text } = appendLink('Read', 'https://en.wikipedia.org/wiki/Foo_(bar)');
    const parsed = parseCapture(text, { projects: [], areas: [] });
    expect(parsed.title).toBe('Read en.wikipedia.org/wiki/Foo_(bar)');
    expect(parsed.props.attachments).toEqual([
      expect.objectContaining({ kind: 'link', uri: 'https://en.wikipedia.org/wiki/Foo_%28bar%29' }),
    ]);
  });
});
