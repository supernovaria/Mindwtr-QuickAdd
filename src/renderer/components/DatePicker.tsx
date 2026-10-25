// Month calendar shown under the field after `due:`, `start:` or `review:`.
// HighlightedField owns the selected date, the keyboard range anchor and the
// keys; this component draws them and handles the mouse (click = one date,
// drag = a start–due range).
import { useEffect, useState } from 'react';
import { addMonths, monthGrid, rowWeekNumber, sameDay, startOfDay, weekdayLabels, type WeekStart } from '../calendar';

interface Props {
  command: 'start' | 'due' | 'review';
  selected: Date;
  /** Other end of a keyboard range (Shift+arrows), if any. */
  anchor: Date | null;
  today: Date;
  weekStart: WeekStart;
  /** Ranges only make sense for start/due. */
  allowRange: boolean;
  /** The selection is the last date a typed value resolved to, not what it says now (dimmed). */
  tentative?: boolean;
  /** Over a typed value only Tab picks (Space and Enter keep their usual meaning). */
  tabOnly?: boolean;
  onPick: (date: Date) => void;
  onPickRange: (from: Date, to: Date) => void;
  /** Switches the command start → due → review. */
  onCycleCommand: () => void;
  /** Moves the selection (the ‹ › month buttons). */
  onNavigate: (date: Date) => void;
}

const COMMAND_LABEL = { start: 'Start', due: 'Due', review: 'Review' } as const;

const ordered = (a: Date, b: Date): [Date, Date] => (a <= b ? [a, b] : [b, a]);

export function DatePicker({ command, selected, anchor, today, weekStart, allowRange, tentative, tabOnly, onPick, onPickRange, onCycleCommand, onNavigate }: Props) {
  const [drag, setDrag] = useState<{ from: Date; to: Date } | null>(null);

  // A drag released outside the calendar is cancelled.
  useEffect(() => {
    if (!drag) return;
    const cancel = () => setDrag(null);
    window.addEventListener('mouseup', cancel);
    return () => window.removeEventListener('mouseup', cancel);
  }, [drag]);

  const finish = (day: Date) => {
    const from = drag?.from ?? day;
    setDrag(null);
    if (allowRange && !sameDay(from, day)) {
      const [first, last] = ordered(from, day);
      onPickRange(first, last);
    } else {
      onPick(day);
    }
  };

  const rangeEnds = drag && allowRange ? [drag.from, drag.to] : anchor && allowRange ? [anchor, selected] : null;
  const range = rangeEnds && !sameDay(rangeEnds[0], rangeEnds[1]) ? ordered(rangeEnds[0], rangeEnds[1]) : null;
  const shown = drag?.to ?? selected;
  const weeks = monthGrid(shown, weekStart);
  const month = shown.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className={tentative ? 'datepicker tentative' : 'datepicker'} role="group" aria-label={`${COMMAND_LABEL[command]} date`}>
      <div className="datepicker-head">
        <div className="datepicker-nav">
          <button
            type="button"
            tabIndex={-1}
            className="datepicker-step"
            aria-label="Previous month"
            title="Previous month (Ctrl+←)"
            onMouseDown={(e) => {
              e.preventDefault(); // keep the caret in the field
              onNavigate(addMonths(selected, -1));
            }}
          >
            ‹
          </button>
          <span className="datepicker-month">{month}</span>
          <button
            type="button"
            tabIndex={-1}
            className="datepicker-step"
            aria-label="Next month"
            title="Next month (Ctrl+→)"
            onMouseDown={(e) => {
              e.preventDefault();
              onNavigate(addMonths(selected, 1));
            }}
          >
            ›
          </button>
        </div>
        <button
          type="button"
          tabIndex={-1}
          className="datepicker-for"
          title="Switch between start, due and review"
          onMouseDown={(e) => {
            e.preventDefault(); // keep the caret in the field
            onCycleCommand();
          }}
        >
          {range ? 'Start → Due' : COMMAND_LABEL[command]} ⇄
        </button>
      </div>
      <table className="datepicker-grid" role="grid">
        <thead>
          <tr>
            <th scope="col" className="datepicker-week" title="Calendar week">Wk</th>
            {weekdayLabels(weekStart).map((day) => (
              <th key={day} scope="col">{day}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].toDateString()}>
              <td className="datepicker-week">{rowWeekNumber(week, weekStart)}</td>
              {week.map((day) => {
                const inRange = range !== null && day >= range[0] && day <= range[1];
                const isSelected = range ? sameDay(day, range[0]) || sameDay(day, range[1]) : sameDay(day, shown);
                const classes = [
                  day.getMonth() !== shown.getMonth() ? 'outside' : '',
                  sameDay(day, today) ? 'today' : '',
                  inRange ? 'in-range' : '',
                  isSelected ? 'selected' : '',
                ].filter(Boolean).join(' ');
                return (
                  <td key={day.toDateString()} role="gridcell" aria-selected={isSelected}>
                    <button
                      type="button"
                      tabIndex={-1}
                      className={classes || undefined}
                      onMouseDown={(e) => {
                        e.preventDefault(); // keep the caret in the field
                        if (e.button === 0) setDrag({ from: startOfDay(day), to: startOfDay(day) });
                      }}
                      onMouseEnter={() => drag && setDrag({ ...drag, to: startOfDay(day) })}
                      onMouseUp={(e) => {
                        if (!drag) return;
                        e.stopPropagation();
                        finish(startOfDay(day));
                      }}
                    >
                      {day.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="suggest-hint">
        Arrows move · Ctrl+←→ month · Ctrl+↑↓ top/bottom
        {allowRange ? ' · Shift or drag: start–due range' : ''} · {tabOnly ? 'Tab puts it in' : 'Tab or Space picks'}
      </div>
    </div>
  );
}
