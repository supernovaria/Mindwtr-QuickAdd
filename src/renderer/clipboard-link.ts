// A URL on the clipboard, offered as a markdown link `[label](url)` at the end
// of the input. The parser turns it into a Links attachment and keeps the label
// in the title. Pure, so main (which reads the clipboard) can use it too.

const MAX_URL_LENGTH = 2048;
const MAX_LABEL_LENGTH = 36;

/** The text when it is exactly one http(s) URL (surrounding whitespace aside), else null. */
export function singleHttpUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH || /\s/.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).hostname ? trimmed : null;
  } catch {
    return null;
  }
}

/** Host plus a short path, e.g. `github.com/mindwtr/mindwtr/issues…`. */
export function linkLabel(url: string): string {
  const parsed = new URL(url);
  let path = parsed.pathname.replace(/\/+$/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep it encoded
  }
  const label = (parsed.hostname.replace(/^www\./i, '') + path).replace(/[[\]\s]+/g, ' ');
  return label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH - 1).replace(/[/ ]+$/, '')}…` : label;
}

/**
 * Appends `[label](url)` after a space, returning the selection that covers the
 * label so typing replaces it. Parentheses and angle brackets in the URL are
 * percent-encoded, which the markdown-link syntax can't hold.
 */
export function appendLink(text: string, url: string): { text: string; selection: [number, number] } {
  const label = linkLabel(url);
  const target = url.replace(/[()<>]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  const base = text.replace(/\s+$/, '');
  const start = base.length + (base ? 1 : 0) + 1;
  return { text: `${base}${base ? ' ' : ''}[${label}](${target})`, selection: [start, start + label.length] };
}
