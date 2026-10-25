import type { Chip } from '../capture';

const MAX_VISIBLE = 8;

/** Passive read-out of what the parser found (after Mindwtr's QuickAddPreview). */
export function PreviewChips({ chips, max = MAX_VISIBLE, compact }: { chips: Chip[]; max?: number; compact?: boolean }) {
  const visible = chips.slice(0, max);
  const overflow = chips.length - visible.length;
  return (
    <div role="status" aria-live="polite" className={`chips${compact ? ' chips-compact' : ''}`}>
      {visible.map((chip) => (
        <span key={chip.key} className={`chip${chip.tone === 'warning' ? ' chip-warning' : ''}`}>
          {chip.label ? <span className="chip-label">{chip.label}</span> : null}
          <span className="chip-value">{chip.value}</span>
        </span>
      ))}
      {overflow > 0 ? <span className="chip">+{overflow}</span> : null}
    </div>
  );
}
