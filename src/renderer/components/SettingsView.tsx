import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ConnectionInfo, InterfaceMode, Settings, SuggestSettings } from '../../preload/api';
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
  const [areaSuggest, setAreaSuggest] = useState<SuggestDraft>(toDraft(DEFAULT_SUGGEST));
  const [projectSuggest, setProjectSuggest] = useState<SuggestDraft>(toDraft(DEFAULT_SUGGEST));
  const [datePicker, setDatePicker] = useState(true);
  const [weekStart, setWeekStart] = useState<Settings['weekStart']>('monday');
  const [tabCompletion, setTabCompletion] = useState(true);
  const [clipboardLinks, setClipboardLinks] = useState(true);
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
      setAreaSuggest(toDraft(s.areaSuggest));
      setProjectSuggest(toDraft(s.projectSuggest));
      setDatePicker(s.datePicker);
      setWeekStart(s.weekStart);
      setTabCompletion(s.tabCompletion);
      setClipboardLinks(s.clipboardLinks);
    });
    void bridge.connectionInfo().then(setInfo);
  }, []);

  const save = async () => {
    const portNumber = port.trim() ? Number(port.trim()) : null;
    if (portNumber !== null && (!Number.isInteger(portNumber) || portNumber < 1024 || portNumber > 65535)) {
      setMessage({ text: 'Port must be a number between 1024 and 65535.', error: true });
      return;
    }
    const area = fromDraft(areaSuggest);
    const project = fromDraft(projectSuggest);
    if (!area || !project) {
      setMessage({ text: 'Suggestion counts must be whole numbers (characters 0 or more, entries 1 or more, or empty for all).', error: true });
      return;
    }
    const result = await bridge.setSettings({
      hotkey,
      apiPort: portNumber,
      apiToken: token.trim() || null,
      startAtLogin,
      interfaceMode,
      areaSuggest: area,
      projectSuggest: project,
      datePicker,
      weekStart,
      tabCompletion,
      clipboardLinks,
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
      <fieldset className="settings-group">
        <legend className="field-label">While typing</legend>
        <SuggestRow label="! Area suggestions" value={areaSuggest} onChange={setAreaSuggest} />
        <SuggestRow label="+ Project suggestions" value={projectSuggest} onChange={setProjectSuggest} />
        <label className="checkbox">
          <input type="checkbox" checked={datePicker} onChange={(e) => setDatePicker(e.target.checked)} />
          <span>Calendar after due:, start: and review:</span>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={tabCompletion} onChange={(e) => setTabCompletion(e.target.checked)} />
          <span>Tab completes commands (d → due:, press again to cycle)</span>
        </label>
        <label className="inline-field">
          <span>Week starts on</span>
          <select className="select select-small" value={weekStart} onChange={(e) => setWeekStart(e.target.value as Settings['weekStart'])}>
            <option value="monday">Monday</option>
            <option value="sunday">Sunday</option>
          </select>
        </label>
      </fieldset>
      <label className="checkbox">
        <input type="checkbox" checked={clipboardLinks} onChange={(e) => setClipboardLinks(e.target.checked)} />
        <span>Offer clipboard links (a copied URL can be added with Ctrl+L)</span>
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

// ---- suggestion settings ----------------------------------------------------

const DEFAULT_SUGGEST: SuggestSettings = { enabled: true, minChars: 1, maxItems: 5 };

/** Form state: counts as typed, so an empty "entries" box can mean "all". */
interface SuggestDraft {
  enabled: boolean;
  minChars: string;
  maxItems: string;
}

const toDraft = (s: SuggestSettings): SuggestDraft => ({
  enabled: s.enabled,
  minChars: String(s.minChars),
  maxItems: s.maxItems === null ? '' : String(s.maxItems),
});

function fromDraft(d: SuggestDraft): SuggestSettings | null {
  const minChars = Number(d.minChars.trim() || '0');
  const maxItems = d.maxItems.trim() ? Number(d.maxItems.trim()) : null;
  if (!Number.isInteger(minChars) || minChars < 0) return null;
  if (maxItems !== null && (!Number.isInteger(maxItems) || maxItems < 1)) return null;
  return { enabled: d.enabled, minChars, maxItems };
}

function SuggestRow({ label, value, onChange }: { label: string; value: SuggestDraft; onChange: (next: SuggestDraft) => void }) {
  return (
    <div className="suggest-setting">
      <label className="checkbox">
        <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
        <span>{label}</span>
      </label>
      <label className="inline-field" title="0 = as soon as you type the marker">
        <span>after</span>
        <input
          className="text-input input-tiny"
          inputMode="numeric"
          disabled={!value.enabled}
          value={value.minChars}
          onChange={(e) => onChange({ ...value, minChars: e.target.value })}
        />
        <span>characters, show</span>
        <input
          className="text-input input-tiny"
          inputMode="numeric"
          placeholder="all"
          disabled={!value.enabled}
          value={value.maxItems}
          onChange={(e) => onChange({ ...value, maxItems: e.target.value })}
        />
        <span>entries</span>
      </label>
    </div>
  );
}
