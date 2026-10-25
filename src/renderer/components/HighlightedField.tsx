// A textarea with live token tinting: the textarea's own text is transparent and
// sits over a "mirror" div that renders the same text with highlighted spans.
// Both share font, padding, border width, wrapping and scroll position, so the
// caret and selection line up with the tinted glyphs underneath.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { segment, type HighlightSpan } from '../capture';
import { activeDateCommand, activeToken, applyCompletion, applyDate, applyDateRange, cycleDateCommand, rankSuggestions, tabCompletion, type TabCompletion } from '../completion';
import { addDays, addMonths, firstSameWeekday, lastSameWeekday, sameDay, startOfDay, toIsoDate, type WeekStart } from '../calendar';
import { typedDateCommand, type TypedDateCommand } from '../date-value';
import { DatePicker } from './DatePicker';

/** Names offered while typing `<marker><name>`, e.g. areas after `!`. */
export interface CompletionSource {
  marker: string;
  names: string[];
  /** Characters after the marker before the list opens (0 = right away). */
  minChars: number;
  /** Most entries shown; null = all. */
  maxItems: number | null;
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
  /** Calendar after an empty `due:`/`start:`/`review:`; omit to turn it off. */
  datePicker?: { weekStart: WeekStart; dueByDate?: Map<string, string[]> };
  /** Tab completes commands (`d` → `due:`); pressing it again cycles. */
  tabComplete?: boolean;
  /** Keeps the popups closed, e.g. while the text is a recalled history entry. */
  quiet?: boolean;
}

export interface HighlightedFieldHandle {
  focus: () => void;
  /** Focuses and selects [start, end). */
  select: (start: number, end: number) => void;
}

export const HighlightedField = forwardRef<HighlightedFieldHandle, Props>(function HighlightedField(
  { value, onChange, highlights, onKeyDown, placeholder, maxRows = 6, minRows = 1, className, ariaLabel, disabled, children, completions, datePicker, tabComplete, quiet },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    },
    select: (start, end) => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
    },
  }));

  // ---- popups under the field ------------------------------------------------
  // Suggestions: arrows move, Space/Tab/Enter accept, Esc dismisses.
  // Date picker: arrows move by day/week, Ctrl+arrows by month / to the top or
  // bottom of the month, Shift+arrows extend a start–due range from where the
  // selection was, Tab/Space/Enter insert, Esc dismisses. Clicking the command
  // label cycles start → due → review.
  // Tab on a command word completes it (`d` → `due:`) and cycles on repeat,
  // except once the calendar is open: there Tab picks, as in the lists.
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pickerDate, setPickerDate] = useState(() => startOfDay(new Date()));
  const [pickerAnchor, setPickerAnchor] = useState<Date | null>(null);
  const [cycle, setCycle] = useState<(TabCompletion & { index: number }) | null>(null);
  const pendingCaret = useRef<number | null>(null);

  // The Tab cycle continues only while the text still holds what it last inserted.
  const cycleActive =
    cycle !== null && value.slice(cycle.start, caret) === cycle.options[cycle.index] ? cycle : null;

  const dateCommand = useMemo(
    () => (datePicker ? activeDateCommand(value, caret) ?? typedDateCommand(value, caret, new Date()) : null),
    [datePicker, value, caret],
  );
  // A value typed after the command (`due:fri`): the calendar shows its date.
  // There only Tab picks (replacing the value); Space and Enter stay text/save.
  const typed = dateCommand && 'date' in dateCommand ? (dateCommand as TypedDateCommand) : null;
  const typedIso = typed?.date ? toIsoDate(typed.date) : null;
  /** The command the calendar last (re)started for, and the typed date it showed. */
  const [followed, setFollowed] = useState<{ start?: number; iso: string | null }>({ iso: null });
  const suggestion = useMemo(() => {
    if (dateCommand) return null;
    for (const source of completions ?? []) {
      const token = activeToken(value, caret, source.marker, source.minChars);
      if (!token) continue;
      const items = rankSuggestions(source.names, token.query, source.maxItems);
      if (items.length > 0) return { token, items };
    }
    return null;
  }, [dateCommand, value, caret, completions]);

  const popupKey = dateCommand ? `date:${dateCommand.start}` : suggestion ? `list:${suggestion.token.start}` : null;
  // While a typed value doesn't resolve, the last date it did resolve to stays
  // up, dimmed; with none yet, the calendar waits. `quiet` (a recalled history
  // entry) keeps every popup closed so the arrows stay with the history.
  const pickerOpen =
    !quiet && dateCommand !== null && dismissed !== popupKey &&
    (!typed || typedIso !== null || (followed.start === typed.start && followed.iso !== null));
  const tentative = typed !== null && !typed.exact && pickerAnchor === null && followed.iso === toIsoDate(pickerDate);
  const listOpen = !quiet && suggestion !== null && dismissed !== popupKey;
  const selected = suggestion ? Math.min(activeIndex, suggestion.items.length - 1) : 0;

  useEffect(() => {
    setActiveIndex(0);
    setNavigated(false);
  }, [suggestion?.token.query, suggestion?.token.start]);
  useEffect(() => {
    if (popupKey === null) setDismissed(null);
  }, [popupKey]);
  // Every new date command starts on today, or on the date typed after it, and
  // follows that date as the value is edited (arrows move on from there).
  // (Keyed on where the command starts, so cycling start/due/review keeps the date.
  // Swapping the word goes through one render where the caret still sits at the
  // old position and no command is found, so only a different start resets.)
  // A layout effect, so a changed date never paints a frame of the old one.
  const dateStart = dateCommand?.start;
  useLayoutEffect(() => {
    if (dateStart === undefined) return;
    const isNew = dateStart !== followed.start;
    if (!isNew && (typedIso === null || typedIso === followed.iso)) return;
    setFollowed({ start: dateStart, iso: typedIso });
    setPickerDate(typed?.date ?? startOfDay(new Date()));
    setPickerAnchor(null);
  }, [dateStart, typedIso]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, listOpen]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (ta && pendingCaret.current !== null) {
      ta.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const replaceWith = (next: { text: string; caret: number }) => {
    pendingCaret.current = next.caret;
    onChange(next.text);
  };
  const acceptName = (name: string) => {
    if (suggestion) replaceWith(applyCompletion(value, suggestion.token, name));
  };
  // A picked date is a typed value too, so the calendar would stay up over it:
  // picking dismisses it until the caret leaves that command.
  const replaceWithDate = (next: { text: string; caret: number }) => {
    const after = typedDateCommand(next.text, next.caret, new Date());
    if (after) setDismissed(`date:${after.start}`);
    replaceWith(next);
  };
  const acceptDate = (date: Date) => {
    if (dateCommand) replaceWithDate(applyDate(value, dateCommand, toIsoDate(date)));
  };
  const acceptRange = (first: Date, last: Date) => {
    if (dateCommand) replaceWithDate(applyDateRange(value, dateCommand, toIsoDate(first), toIsoDate(last)));
  };
  const rangeAllowed = dateCommand?.command === 'start' || dateCommand?.command === 'due';
  const cycleCommand = () => {
    if (!dateCommand) return;
    const next = cycleDateCommand(value, dateCommand);
    // Over a typed value, the caret stays where it was in the value.
    replaceWith(typed ? { ...next, caret: caret + next.text.length - value.length } : next);
  };

  const replaceSpan = (start: number, end: number, inserted: string) => {
    pendingCaret.current = start + inserted.length;
    onChange(value.slice(0, start) + inserted + value.slice(end));
  };

  const isAccept = (event: KeyboardEvent<HTMLTextAreaElement>) =>
    event.key === ' ' || event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return onKeyDown?.(event);
    const { key, shiftKey } = event;
    if (key === 'Tab' && tabComplete && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // In the calendar, Tab picks; Shift+Tab still steps back through the cycle.
      if (cycleActive && (!pickerOpen || shiftKey)) {
        event.preventDefault();
        const count = cycleActive.options.length;
        const index = (cycleActive.index + (shiftKey ? count - 1 : 1)) % count;
        setCycle({ ...cycleActive, index });
        replaceSpan(cycleActive.start, caret, cycleActive.options[index]);
        return;
      }
      const found = !shiftKey && !pickerOpen && !listOpen ? tabCompletion(value, caret) : null;
      if (found) {
        event.preventDefault();
        setCycle({ ...found, index: 0 });
        replaceSpan(found.start, caret, found.options[0]);
        return;
      }
    }
    if ((pickerOpen || listOpen) && key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(popupKey);
      return;
    }
    if (pickerOpen && dateCommand) {
      const moves: Record<string, (d: Date) => Date> = event.ctrlKey || event.metaKey
        ? { ArrowLeft: (d) => addMonths(d, -1), ArrowRight: (d) => addMonths(d, 1), ArrowUp: firstSameWeekday, ArrowDown: lastSameWeekday }
        : { ArrowLeft: (d) => addDays(d, -1), ArrowRight: (d) => addDays(d, 1), ArrowUp: (d) => addDays(d, -7), ArrowDown: (d) => addDays(d, 7) };
      if (moves[key]) {
        event.preventDefault();
        if (shiftKey && rangeAllowed) setPickerAnchor((anchor) => anchor ?? pickerDate);
        else setPickerAnchor(null);
        setPickerDate(moves[key]);
        return;
      }
      if (typed ? key === 'Tab' : isAccept(event)) {
        event.preventDefault();
        if (pickerAnchor && rangeAllowed && !sameDay(pickerAnchor, pickerDate)) {
          const [first, last] = pickerAnchor < pickerDate ? [pickerAnchor, pickerDate] : [pickerDate, pickerAnchor];
          acceptRange(first, last);
        } else {
          acceptDate(pickerDate);
        }
        return;
      }
    }
    if (listOpen && suggestion) {
      const count = suggestion.items.length;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((selected + (key === 'ArrowDown' ? 1 : count - 1)) % count);
        setNavigated(true);
        return;
      }
      // With nothing typed after the marker yet, a plain Space is just a space
      // unless an entry was chosen with the arrows.
      const spaceIsText = key === ' ' && !suggestion.token.query && !navigated;
      if (isAccept(event) && !spaceIsText) {
        event.preventDefault();
        acceptName(suggestion.items[selected]);
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
        aria-expanded={completions || datePicker ? listOpen || pickerOpen : undefined}
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
    {cycleActive && cycleActive.options.length > 1 ? (
      <div className="cycle-hint" aria-live="polite">
        <span className="cycle-key">Tab</span>
        {cycleActive.options.map((option, index) => (
          <span key={option} className={index === cycleActive.index ? 'cycle-option current' : 'cycle-option'}>
            {option}
          </span>
        ))}
      </div>
    ) : null}
    {pickerOpen && dateCommand && datePicker ? (
      <DatePicker
        command={dateCommand.command}
        selected={pickerDate}
        anchor={pickerAnchor}
        today={startOfDay(new Date())}
        weekStart={datePicker.weekStart}
        dueByDate={datePicker.dueByDate}
        allowRange={rangeAllowed}
        tentative={tentative}
        tabOnly={typed !== null}
        onPick={acceptDate}
        onPickRange={acceptRange}
        onCycleCommand={cycleCommand}
        onNavigate={(date) => {
          setPickerAnchor(null);
          setPickerDate(date);
        }}
      />
    ) : null}
    {listOpen && suggestion ? (
      <div className="suggest">
        <ul ref={listRef} className="suggest-list" role="listbox" aria-label="Suggestions">
          {suggestion.items.map((name, index) => (
            <li
              key={name}
              role="option"
              aria-selected={index === selected}
              className={index === selected ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptName(name);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="suggest-marker">{suggestion.token.marker}</span>
              {name}
            </li>
          ))}
        </ul>
        <div className="suggest-hint" aria-hidden="true">↑↓ to move · Space to pick</div>
      </div>
    ) : null}
    </>
  );
});
