// A textarea with live token tinting: the textarea's own text is transparent and
// sits over a "mirror" div that renders the same text with highlighted spans.
// Both share font, padding, border width, wrapping and scroll position, so the
// caret and selection line up with the tinted glyphs underneath.
import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { segment, type HighlightSpan } from '../capture';

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
}

export interface HighlightedFieldHandle {
  focus: () => void;
}

export const HighlightedField = forwardRef<HighlightedFieldHandle, Props>(function HighlightedField(
  { value, onChange, highlights, onKeyDown, placeholder, maxRows = 6, minRows = 1, className, ariaLabel, disabled, children },
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
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
      />
      {children}
    </div>
  );
});
