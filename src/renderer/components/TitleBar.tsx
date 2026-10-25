import { useEffect, useRef, useState } from 'react';

export type CaptureMode = 'text' | 'audio';
export type MenuAction = 'import' | 'bulk' | 'single' | 'settings' | 'quit';

interface Props {
  title: string;
  mode?: CaptureMode;
  onModeChange?: (mode: CaptureMode) => void;
  modeLocked?: boolean;
  audioDisabledReason?: string;
  onMenu: (action: MenuAction) => void;
  onClose: () => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  /** In Bulk add the menu offers the way back to a single task instead. */
  inBulk?: boolean;
}

type MenuItem = { action: MenuAction; label: string; hint?: string };

const menuFor = (inBulk: boolean): MenuItem[] => [
  { action: 'import', label: 'Import .txt…' },
  inBulk
    ? { action: 'single', label: 'Single task', hint: 'Esc' }
    : { action: 'bulk', label: 'Bulk add', hint: 'Ctrl+Enter saves' },
  { action: 'settings', label: 'Settings' },
  { action: 'quit', label: 'Quit QuickAdd' },
];

export function TitleBar({
  title,
  mode,
  onModeChange,
  modeLocked,
  audioDisabledReason,
  onMenu,
  onClose,
  menuOpen,
  setMenuOpen,
  inBulk = false,
}: Props) {
  const MENU = menuFor(inBulk);
  const menuRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!menuOpen) return;
    setActive(0);
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [menuOpen, setMenuOpen]);

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[active]?.focus();
  }, [menuOpen, active]);

  return (
    <header className="titlebar">
      <h1 className="titlebar-title">{title}</h1>
      {mode && onModeChange ? (
        <div className="segmented" role="radiogroup" aria-label="Capture mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'text'}
            className={mode === 'text' ? 'on' : ''}
            disabled={modeLocked}
            onClick={() => onModeChange('text')}
          >
            Text
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'audio'}
            className={mode === 'audio' ? 'on' : ''}
            disabled={modeLocked || !!audioDisabledReason}
            title={audioDisabledReason}
            onClick={() => onModeChange('audio')}
          >
            Audio
          </button>
        </div>
      ) : null}
      <div className="titlebar-spacer" />
      <div className="menu-anchor" ref={menuRef}>
        <button
          type="button"
          className="icon-button"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="3" cy="8" r="1.4" fill="currentColor" />
            <circle cx="8" cy="8" r="1.4" fill="currentColor" />
            <circle cx="13" cy="8" r="1.4" fill="currentColor" />
          </svg>
        </button>
        {menuOpen ? (
          <div
            className="menu"
            role="menu"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => (i + 1) % MENU.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => (i - 1 + MENU.length) % MENU.length);
              }
            }}
          >
            {MENU.map((item, index) => (
              <button
                key={item.action}
                type="button"
                role="menuitem"
                tabIndex={index === active ? 0 : -1}
                className={item.action === 'quit' ? 'menu-item menu-item-sep' : 'menu-item'}
                onClick={() => {
                  setMenuOpen(false);
                  onMenu(item.action);
                }}
              >
                <span>{item.label}</span>
                {item.hint ? <span className="menu-hint">{item.hint}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" className="esc-hint" tabIndex={-1} onClick={onClose} aria-label="Close" title="Hide (Esc)">
        Esc
      </button>
    </header>
  );
}
