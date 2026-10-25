// Month calendar shown under the field after `due:`, `start:` or `review:`.
// Purely presentational: HighlightedField owns the selected date and the keys.
import { monthGrid, sameDay, weekdayLabels, type WeekStart } from '../calendar';

interface Props {
  command: 'start' | 'due' | 'review';
  selected: Date;
  today: Date;
  weekStart: WeekStart;
  onPick: (date: Date) => void;
}

const COMMAND_LABEL = { start: 'Start', due: 'Due', review: 'Review' } as const;

export function DatePicker({ command, selected, today, weekStart, onPick }: Props) {
  const weeks = monthGrid(selected, weekStart);
  const month = selected.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = weekdayLabels(weekStart);

  return (
    <div className="datepicker" role="group" aria-label={`${COMMAND_LABEL[command]} date`}>
      <div className="datepicker-head">
        <span className="datepicker-month">{month}</span>
        <span className="datepicker-for">{COMMAND_LABEL[command]}</span>
      </div>
      <table className="datepicker-grid" role="grid">
        <thead>
          <tr>
            {weekdays.map((day) => (
              <th key={day} scope="col">{day}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].toDateString()}>
              {week.map((day) => {
                const classes = [
                  day.getMonth() !== selected.getMonth() ? 'outside' : '',
                  sameDay(day, today) ? 'today' : '',
                  sameDay(day, selected) ? 'selected' : '',
                ].filter(Boolean).join(' ');
                return (
                  <td key={day.toDateString()} role="gridcell" aria-selected={sameDay(day, selected)}>
                    <button
                      type="button"
                      tabIndex={-1}
                      className={classes || undefined}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onPick(day);
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
        ←→ day · ↑↓ week · Shift+←→ month · Shift+↑↓ top/bottom of month · Space to pick
      </div>
    </div>
  );
}
