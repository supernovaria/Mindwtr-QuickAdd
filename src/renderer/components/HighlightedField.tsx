// A textarea with live token tinting: the textarea's own text is transparent and
// sits over a "mirror" div that renders the same text with highlighted spans.
// Both share font, padding, border width, wrapping and scroll position, so the
// caret and selection line up with the tinted glyphs underneath.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { segment, type HighlightSpan } from '../capture';
import { activeToken, applyCompletion, rankSuggestions } from '../completion';

/** Names offered while typing `<marker><letters>`, e.g. areas after `!`. */
export interface CompletionSource {
  marker: string;
  names: string[];
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  highlights: HighlightSpan[];
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  /** Visible rows before the field scrolls. */
  maxRows?: number;
  minRows?: number;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Extra content inside the field (e.g. the star button). */
  children?: ReactNode;
  completions?: CompletionSource[];
}

export interface HighlightedFieldHandle {
  focus: () => void;
}

export const HighlightedField = forwardRef<HighlightedFieldHandle, Props>(function HighlightedField(
  { value, onChange, highlights, onKeyDown, placeholder, maxRows = 6, minRows = 1, className, ariaLabel, disabled, children, completions },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    },
  }));

  // ---- autocomplete: up to 5 names under the field; arrows move, Space/Tab/Enter accept, Esc dismisses.
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const suggestion = useMemo(() => {
    for (const source of completions ?? []) {
      const token = activeToken(value, caret, source.marker);
      if (!token) continue;
      const items = rankSuggestions(source.names, token.query);
      if (items.length > 0) return { token, items };
    }
    return null;
  }, [value, caret, completions]);
  const open = suggestion !== null && dismissedAt !== suggestion.token.start;
  const selected = suggestion ? Math.min(activeIndex, suggestion.items.length - 1) : 0;

  useEffect(() => setActiveIndex(0), [suggestion?.token.query, suggestion?.token.start]);
  useEffect(() => {
    if (!suggestion) setDismissedAt(null);
  }, [suggestion]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (ta && pendingCaret.current !== null) {
      ta.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const accept = (name: string) => {
    if (!suggestion) return;
    const next = applyCompletion(value, suggestion.token, name);
    pendingCaret.current = next.caret;
    onChange(next.text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && suggestion && !event.nativeEvent.isComposing) {
      const count = suggestion.items.length;
      const { key } = event;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((selected + (key === 'ArrowDown' ? 1 : count - 1)) % count);
        return;
      }
      if (key === ' ' || key === 'Tab' || (key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey)) {
        event.preventDefault();
        accept(suggestion.items[selected]);
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissedAt(suggestion.token.start);
        return;
      }
    }
    onKeyDown?.(event);
  };

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (ta && mirror) {
      mirror.scrollTop = ta.scrollTop;
      mirror.scrollLeft = ta.scrollLeft;
    }
  }, []);

  // Grow with content up to maxRows, then scroll.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const style = getComputedStyle(ta);
    const line = parseFloat(style.lineHeight) || 20;
    const chrome =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    ta.style.height = 'auto';
    const content = ta.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const rows = Math.min(Math.max(Math.round(content / line), minRows), maxRows);
    ta.style.height = `${rows * line + chrome}px`;
    ta.style.overflowY = Math.round(content / line) > maxRows ? 'auto' : 'hidden';
    syncScroll();
  }, [value, maxRows, minRows, syncScroll]);

  const segments = segment(value, highlights);

  return (
    <>
    <div className={`hl-field ${className ?? ''}`}>
      <div ref={mirrorRef} className="hl-mirror" aria-hidden="true">
        {segments.map((seg, i) =>
          seg.kind ? (
            <mark key={i} className={`hl-token hl-${seg.kind}`}>
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
        {/* keeps a trailing newline from collapsing so heights match */}
        {'​'}
      </div>
      <textarea
        ref={textareaRef}
        className="hl-input"
        value={value}
        rows={minRows}
        spellCheck
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder}
        aria-autocomplete={completions ? 'list' : undefined}
        aria-expanded={completions ? open : undefined}
        onChange={(e) => {
          setCaret(e.target.selectionStart);
          onChange(e.target.value);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
      />
      {children}
    </div>
    {open && suggestion ? (
      <ul className="suggest" role="listbox" aria-label="Suggestions">
        {suggestion.items.map((name, index) => (
          <li
            key={name}
            role="option"
            aria-selected={index === selected}
            className={index === selected ? 'active' : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              accept(name);
            }}
            onMouseEnter={() => setActiveIndex(index)}
          >
            <span className="suggest-marker">{suggestion.token.marker}</span>
            {name}
          </li>
        ))}
        <li className="suggest-hint" aria-hidden="true">↑↓ to move · Space to pick</li>
      </ul>
    ) : null}
    </>
  );
});
