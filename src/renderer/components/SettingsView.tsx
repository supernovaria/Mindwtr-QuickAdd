import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ConnectionInfo, InterfaceMode, Settings } from '../../preload/api';
import { bridge } from '../bridge';

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']);

/** Turns a keydown into an Electron accelerator ("Control+Alt+Space"), or null. */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (mods.length === 0) return null;
  let key: string | null = null;
  const code = e.code;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (/^Numpad[0-9]$/.test(code)) key = `num${code.slice(6)}`;
  else {
    const named: Record<string, string> = {
      Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
      Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
      Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    };
    key = named[code] ?? null;
  }
  return key ? [...mods, key].join('+') : null;
}

export const prettyAccelerator = (accel: string) => accel.replace(/Control/g, 'Ctrl').replace(/Super/g, 'Win').replace(/\+/g, ' + ');

interface Props {
  onDone: () => void;
  onSaved: () => void;
}

export function SettingsView({ onDone, onSaved }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [hotkey, setHotkey] = useState('');
  const [port, setPort] = useState('');
  const [token, setToken] = useState('');
  const [startAtLogin, setStartAtLogin] = useState(false);
  const [interfaceMode, setInterfaceMode] = useState<InterfaceMode>('full');
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [recordingKey, setRecordingKey] = useState(false);

  useEffect(() => {
    void bridge.getSettings().then((s) => {
      setSettings(s);
      setHotkey(s.hotkey);
      setPort(s.apiPort ? String(s.apiPort) : '');
      setToken(s.apiToken ?? '');
      setStartAtLogin(s.startAtLogin);
      setInterfaceMode(s.interfaceMode);
    });
    void bridge.connectionInfo().then(setInfo);
  }, []);

  const save = async () => {
    const portNumber = port.trim() ? Number(port.trim()) : null;
    if (portNumber !== null && (!Number.isInteger(portNumber) || portNumber < 1024 || portNumber > 65535)) {
      setMessage({ text: 'Port must be a number between 1024 and 65535.', error: true });
      return;
    }
    const result = await bridge.setSettings({
      hotkey,
      apiPort: portNumber,
      apiToken: token.trim() || null,
      startAtLogin,
      interfaceMode,
    });
    setSettings(result.settings);
    setHotkey(result.settings.hotkey);
    setInfo(await bridge.connectionInfo());
    if (result.error) {
      setMessage({ text: result.error, error: true });
      return;
    }
    const test = await bridge.listAreas();
    setMessage(
      test.ok
        ? { text: `Saved. Connected to Mindwtr (${test.data.length} areas).` }
        : { text: `Saved, but: ${test.error.message}`, error: true },
    );
    onSaved();
  };

  if (!settings) return <div className="body muted">Loading…</div>;

  return (
    <form
      className="body settings"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="field">
        <span className="field-label">Global shortcut</span>
        <input
          className="text-input"
          readOnly
          value={recordingKey ? 'Press the new shortcut…' : prettyAccelerator(hotkey)}
          onFocus={() => setRecordingKey(true)}
          onBlur={() => setRecordingKey(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Tab') return;
            e.preventDefault();
            e.stopPropagation();
            const accel = acceleratorFromEvent(e);
            if (accel) {
              setHotkey(accel);
              setRecordingKey(false);
            }
          }}
        />
        <span className="field-help">Click the box, then press a combination with Ctrl, Alt, Shift or Win.</span>
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Local API port</span>
          <input
            className="text-input"
            inputMode="numeric"
            placeholder={info ? `auto (${info.port})` : 'auto'}
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <label className="field field-grow">
          <span className="field-label">Local API token</span>
          <input
            className="text-input"
            type="password"
            autoComplete="off"
            placeholder={info?.tokenSource === 'mindwtr-config' ? 'auto-detected from Mindwtr' : 'auto-detect'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </div>
      <p className="field-help">
        Leave both empty to read them from Mindwtr's config
        {info?.configDir ? <> (<code title={info.configDir}>…\{info.configDir.split(/[\\/]/).slice(-4).join('\\')}</code>)</> : ' (not found)'}.
        {info ? ` Now using port ${info.port} (${info.portSource}), token: ${info.tokenSource}.` : ''}
        {info?.enabledInConfig === false ? ' Mindwtr reports the Local API as off: enable it in Mindwtr → Settings → Advanced.' : ''}
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={startAtLogin} onChange={(e) => setStartAtLogin(e.target.checked)} />
        <span>Start QuickAdd when I sign in{bridge.isElectron ? '' : ' (desktop app only)'}</span>
      </label>
      <label className="area-row">
        <span className="field-label">Interface</span>
        <select className="select" value={interfaceMode} onChange={(e) => setInterfaceMode(e.target.value as InterfaceMode)}>
          <option value="full">Full</option>
          <option value="reduced">Reduced: no example line, syntax help as "?"</option>
          <option value="minimal">Minimal: just the input (no area, help or buttons)</option>
        </select>
      </label>
      {message ? (
        <p className={message.error ? 'error-text' : 'ok-text'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}
      <div className="footer-row">
        <div />
        <div className="actions">
          <button type="button" className="btn btn-muted" onClick={onDone}>
            Back
          </button>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </div>
      </div>
    </form>
  );
}
