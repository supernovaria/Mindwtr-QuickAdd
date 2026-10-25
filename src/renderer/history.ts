// Shell-style input history for the single-task field: every saved input, newest
// first. ↑ recalls older entries while the field is empty or still holds an
// unedited recalled entry; ↓ goes back towards newer ones and then to empty.

export const HISTORY_LIMIT = 50;
const STORAGE_KEY = 'mindwtr-quickadd.history';

/** The history with `text` added at the front (once, without blank entries). */
export function rememberEntry(entries: readonly string[], text: string, limit = HISTORY_LIMIT): string[] {
  if (!text.trim()) return [...entries];
  return [text, ...entries.filter((entry) => entry !== text)].slice(0, limit);
}

export interface HistoryStep {
  /** Index of the recalled entry; null = back to an empty field. */
  index: number | null;
  text: string;
}

/**
 * What ↑ (`older`) or ↓ (`newer`) does, given the field's text and the entry
 * last recalled (`cursor`). Null when the key should keep its usual meaning:
 * the user has typed or edited something, or there is nowhere to go.
 */
export function historyStep(
  entries: readonly string[],
  cursor: number | null,
  current: string,
  direction: 'older' | 'newer',
): HistoryStep | null {
  const recalled = cursor !== null && entries[cursor] === current ? cursor : null;
  if (recalled === null && current !== '') return null;
  if (direction === 'older') {
    const index = recalled === null ? 0 : recalled + 1;
    return index < entries.length ? { index, text: entries[index] } : null;
  }
  if (recalled === null) return null;
  return recalled === 0 ? { index: null, text: '' } : { index: recalled - 1, text: entries[recalled - 1] };
}

/** Reads the stored history; empty when storage is unavailable or garbled. */
export function loadHistory(storage?: Pick<Storage, 'getItem'>): string[] {
  try {
    const parsed: unknown = JSON.parse((storage ?? localStorage).getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: readonly string[], storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // History is a convenience; a full or blocked storage just loses it.
  }
}
