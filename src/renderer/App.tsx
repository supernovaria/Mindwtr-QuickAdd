import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Area, Attachment, Project } from '../../vendor/mindwtr-core/src/types';
import type { ApiError, CreateTaskInput, CreateTaskOutcome, InterfaceMode, KnownTokens, View } from '../preload/api';
import { bridge } from './bridge';
import {
  bulkHighlights,
  chipsFor,
  safeParse,
  safeParseBulk,
  type CaptureContext,
  type CaptureDefaults,
} from './capture';
import { AudioCapture, audioUnsupportedReason } from './components/AudioCapture';
import { HighlightedField, type HighlightedFieldHandle } from './components/HighlightedField';
import { PreviewChips } from './components/PreviewChips';
import { SettingsView } from './components/SettingsView';
import { QUICK_ADD_EXAMPLE, SyntaxHelpContent } from './components/SyntaxHelp';
import { TitleBar, type CaptureMode, type MenuAction } from './components/TitleBar';

const ADDED_FLASH_MS = 700;
const BODY_MARGIN = 8; // transparent gutter around the card (see styles.css)

type Status = { kind: 'error'; text: string } | { kind: 'added'; text: string } | null;

export function App() {
  const [view, setView] = useState<View>('text');
  const [mode, setMode] = useState<CaptureMode>('text');
  const [text, setText] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [focusToday, setFocusToday] = useState(false);
  const [areaId, setAreaId] = useState('');
  const [areas, setAreas] = useState<Area[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [known, setKnown] = useState<KnownTokens>({ contexts: [], tags: [] });
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [submitting, setSubmitting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [ui, setUi] = useState<InterfaceMode>('full');

  const cardRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HighlightedFieldHandle>(null);
  const bulkRef = useRef<HighlightedFieldHandle>(null);
  const audioUnsupported = useMemo(() => audioUnsupportedReason(), []);

  // ---- data from Mindwtr -------------------------------------------------
  const refresh = useCallback(async () => {
    const [a, p, k] = await Promise.all([bridge.listAreas(), bridge.listProjects(), bridge.knownTokens()]);
    if (a.ok) setAreas(a.data);
    if (p.ok) setProjects(p.data);
    if (k.ok) setKnown(k.data);
    const failure = [a, p, k].find((r) => !r.ok);
    setApiError(failure && !failure.ok ? failure.error : null);
  }, []);

  useEffect(() => {
    void refresh();
    void bridge.getSettings().then((s) => {
      setAreaId(s.lastAreaId);
      setUi(s.interfaceMode);
    });
  }, [refresh]);

  const focusInput = useCallback((which: View = view) => {
    requestAnimationFrame(() => (which === 'bulk' ? bulkRef.current : fieldRef.current)?.focus());
  }, [view]);

  useEffect(
    () =>
      bridge.onShow((event) => {
        setMenuOpen(false);
        if (event.bulkText !== undefined) setBulkText(event.bulkText);
        if (event.notice) setStatus({ kind: 'error', text: event.notice });
        const next = event.view ?? 'text';
        setView(next);
        focusInput(next);
        void refresh();
      }),
    [view, focusInput, refresh],
  );

  // ---- auto-fit window height --------------------------------------------
  // The window also has to fit the open "…" menu, which can hang below a short card.
  const reportSize = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const menu = card.querySelector('[role="menu"]');
    const bottom = menu ? Math.max(rect.bottom, menu.getBoundingClientRect().bottom + 8) : rect.bottom;
    bridge.resize(Math.ceil(bottom - rect.top) + BODY_MARGIN * 2);
  }, []);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    reportSize();
    const observer = new ResizeObserver(reportSize);
    observer.observe(card);
    return () => observer.disconnect();
  }, [reportSize]);

  useLayoutEffect(reportSize, [menuOpen, reportSize]);

  // ---- parsing --------------------------------------------------------------
  const ctx: CaptureContext = useMemo(
    () => ({ projects, areas, knownContexts: known.contexts, knownTags: known.tags }),
    [projects, areas, known],
  );
  const defaults: CaptureDefaults = useMemo(
    () => ({ areaId: areaId || undefined, isFocusedToday: focusToday || undefined }),
    [areaId, focusToday],
  );
  const parsed = useMemo(() => safeParse(text, ctx, defaults), [text, ctx, defaults]);
  const chips = useMemo(() => chipsFor(parsed, areas, projects), [parsed, areas, projects]);
  const completions = useMemo(() => [{ marker: '!', names: areas.map((a) => a.name) }], [areas]);
  const bulkLines = useMemo(
    () => (view === 'bulk' ? safeParseBulk(bulkText, ctx, defaults) : []),
    [view, bulkText, ctx, defaults],
  );
  const bulkSpans = useMemo(() => bulkHighlights(bulkLines), [bulkLines]);

  // ---- actions ------------------------------------------------------------------
  const hide = useCallback(() => {
    setMenuOpen(false);
    bridge.hide();
  }, []);

  const flashAddedThenHide = useCallback(
    (message: string, reset: () => void) => {
      setStatus({ kind: 'added', text: message });
      window.setTimeout(() => {
        reset();
        setStatus(null);
        setFocusToday(false);
        bridge.hide();
      }, ADDED_FLASH_MS);
    },
    [],
  );

  const firstError = (outcomes: CreateTaskOutcome[]) => outcomes.find((o) => !o.ok)?.error;

  const send = useCallback(async (items: CreateTaskInput[]) => {
    setSubmitting(true);
    setStatus(null);
    try {
      return await bridge.createTasks(items);
    } catch (error) {
      return items.map(() => ({ ok: false, error: { code: 'http', message: String(error) } as ApiError }));
    } finally {
      setSubmitting(false);
    }
  }, []);

  const saveText = useCallback(async () => {
    if (submitting) return;
    if (!parsed.title.trim()) {
      setStatus({ kind: 'error', text: text.trim() ? 'The task needs a title besides the tokens.' : 'Type a task first.' });
      return;
    }
    const outcomes = await send([{ title: parsed.title, props: parsed.props, newProject: parsed.newProject }]);
    if (parsed.newProject) void refresh();
    const error = firstError(outcomes);
    if (error) {
      setStatus({ kind: 'error', text: error.message });
      if (error.code !== 'http') setApiError(error);
      return;
    }
    setApiError(null);
    flashAddedThenHide('Added', () => setText(''));
  }, [submitting, parsed, text, send, flashAddedThenHide, refresh]);

  const saveBulk = useCallback(async () => {
    if (submitting) return;
    const lines = bulkLines.filter((l) => l.title.trim());
    if (lines.length === 0) {
      setStatus({ kind: 'error', text: 'Nothing to add: each non-empty line becomes a task.' });
      return;
    }
    const outcomes = await send(lines.map((l) => ({ title: l.title, props: l.props, newProject: l.newProject })));
    if (lines.some((l) => l.newProject)) void refresh();
    const failed = lines.filter((_, i) => !outcomes[i]?.ok);
    const added = lines.length - failed.length;
    if (failed.length === 0) {
      setApiError(null);
      flashAddedThenHide(`Added ${added} task${added === 1 ? '' : 's'}`, () => {
        setBulkText('');
        setView('text');
      });
      return;
    }
    // Keep only the lines that failed, so retrying doesn't duplicate.
    setBulkText(failed.map((l) => l.raw).join('\n'));
    const error = firstError(outcomes);
    if (error && error.code !== 'http') setApiError(error);
    setStatus({
      kind: 'error',
      text: `${added ? `Added ${added}. ` : ''}${failed.length} line${failed.length === 1 ? '' : 's'} failed (kept below): ${error?.message ?? 'unknown error'}`,
    });
  }, [submitting, bulkLines, send, flashAddedThenHide, refresh]);

  const saveAudio = useCallback(
    async (data: ArrayBuffer, mimeType: string) => {
      setSubmitting(true);
      try {
        const file = await bridge.saveRecording(data, mimeType);
        const stamp = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        const typed = text.trim() ? parsed : null;
        const nowIso = new Date().toISOString();
        const attachment: Attachment = {
          id: crypto.randomUUID(),
          kind: 'file',
          title: file.fileName,
          uri: file.path,
          mimeType: file.mimeType,
          size: file.size,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const baseProps = typed ? typed.props : { ...(areaId ? { areaId } : {}), ...(focusToday ? { isFocusedToday: true } : {}) };
        const existing = Array.isArray(baseProps.attachments) ? (baseProps.attachments as Attachment[]) : [];
        const title = typed?.title.trim() || `Audio note ${stamp}`;
        const outcomes = await send([
          { title, props: { ...baseProps, attachments: [...existing, attachment] }, newProject: typed?.newProject },
        ]);
        const error = firstError(outcomes);
        if (error) {
          setStatus({ kind: 'error', text: `${error.message} The recording is kept at ${file.path}.` });
          return;
        }
        flashAddedThenHide('Added audio note', () => {
          setText('');
          setMode('text');
        });
      } catch (error) {
        setStatus({ kind: 'error', text: `Couldn't save the recording: ${String(error)}` });
      } finally {
        setSubmitting(false);
      }
    },
    [text, parsed, areaId, focusToday, send, flashAddedThenHide],
  );

  const importTxt = useCallback(async () => {
    try {
      const file = await bridge.importTxt();
      if (!file) return;
      setBulkText((current) => (current.trim() ? `${current.replace(/\s+$/, '')}\n${file.text}` : file.text));
      setView('bulk');
      focusInput('bulk');
    } catch (error) {
      setStatus({ kind: 'error', text: `Couldn't read the file: ${String(error)}` });
    }
  }, [focusInput]);

  const onMenu = (action: MenuAction) => {
    setStatus(null);
    if (action === 'import') void importTxt();
    else if (action === 'single') leaveBulk();
    else if (action === 'bulk') {
      if (view === 'text' && text.trim() && !bulkText.trim()) setBulkText(text);
      setView('bulk');
      focusInput('bulk');
    } else if (action === 'settings') setView('settings');
    else bridge.quit();
  };

  function leaveBulk() {
    setStatus(null);
    setView('text');
    focusInput('text');
  }

  const changeArea = (next: string) => {
    setAreaId(next);
    void bridge.setSettings({ lastAreaId: next });
  };

  // Esc hides from anywhere (the menu closes first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (menuOpen) setMenuOpen(false);
      else if (view === 'bulk') leaveBulk();
      else if (!recording) hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- render -------------------------------------------------------------------
  const title = view === 'bulk' ? 'Bulk add' : view === 'settings' ? 'Settings' : 'Add Task';
  const statusLine =
    status?.kind === 'added' ? (
      <span className="ok-text" role="status">✓ {status.text}</span>
    ) : null;

  const errorBanner =
    view !== 'settings' && (status?.kind === 'error' || apiError) ? (
      <div className="banner" role="alert">
        <span>{status?.kind === 'error' ? status.text : apiError?.message}</span>
        {apiError ? (
          <button type="button" className="link-button" onClick={() => void refresh()}>
            Retry
          </button>
        ) : null}
      </div>
    ) : null;

  const areaSelect = (
    <label className="area-row">
      <span className="field-label">Area</span>
      <select className="select" value={areaId} onChange={(e) => changeArea(e.target.value)}>
        <option value="">No area</option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.icon ? `${a.icon} ` : ''}
            {a.name}
          </option>
        ))}
        {areaId && !areas.some((a) => a.id === areaId) ? <option value={areaId}>(unknown area)</option> : null}
      </select>
    </label>
  );

  const helpToggle = (
    <button type="button" className="disclosure" aria-expanded={helpOpen} onClick={() => setHelpOpen((o) => !o)}>
      <span className="disclosure-caret" aria-hidden="true">▸</span>
      {ui === 'full' ? 'Quick Add syntax help' : <span aria-label="Quick Add syntax help" title="Quick Add syntax help">?</span>}
    </button>
  );

  const starButton = (
    <button
      type="button"
      className={`star${focusToday ? ' on' : ''}`}
      aria-pressed={focusToday}
      aria-label={focusToday ? "Remove from today's focus" : "Add to today's focus"}
      title={focusToday ? "Remove from today's focus" : "Add to today's focus"}
      onClick={() => setFocusToday((f) => !f)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
          fill={focusToday ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  return (
    <div className="card" ref={cardRef}>
      <TitleBar
        title={title}
        mode={view === 'text' ? mode : undefined}
        onModeChange={(m) => {
          setMode(m);
          setStatus(null);
          if (m === 'text') focusInput('text');
        }}
        modeLocked={recording || submitting}
        audioDisabledReason={audioUnsupported}
        onMenu={onMenu}
        onClose={view === 'bulk' ? leaveBulk : hide}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        inBulk={view === 'bulk'}
      />

      {view === 'settings' ? (
        <SettingsView
          onDone={() => {
            setView('text');
            focusInput('text');
          }}
          onSaved={() => {
            void refresh();
            void bridge.getSettings().then((s) => setUi(s.interfaceMode));
          }}
        />
      ) : view === 'bulk' ? (
        <form
          className="body"
          onSubmit={(e) => {
            e.preventDefault();
            void saveBulk();
          }}
        >
          <HighlightedField
            ref={bulkRef}
            className="field-bulk"
            value={bulkText}
            onChange={setBulkText}
            highlights={bulkSpans}
            completions={completions}
            minRows={4}
            maxRows={10}
            ariaLabel="Tasks, one per line"
            placeholder={'One task per line, e.g.\nCall mom due:tomorrow @phone\nDraft report +Website !2'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void saveBulk();
              }
            }}
          />
          {bulkLines.length > 0 ? (
            <div className="bulk-preview" aria-label="Preview">
              {bulkLines.slice(0, 50).map((l) => (
                <div key={`${l.line}:${l.raw}`} className="bulk-line">
                  <span className="bulk-title">{l.title || <em className="muted">(no title)</em>}</span>
                  <PreviewChips chips={chipsFor(l, areas, projects)} max={5} compact />
                </div>
              ))}
              {bulkLines.length > 50 ? <div className="muted bulk-more">+{bulkLines.length - 50} more</div> : null}
            </div>
          ) : null}
          {ui === 'minimal' ? null : areaSelect}
          {errorBanner}
          <div className="footer-row">
            <span className="muted">
              {bulkLines.length} task{bulkLines.length === 1 ? '' : 's'} · Ctrl+Enter saves all
            </span>
            <div className="actions">
              {statusLine}
              <button
                type="button"
                className="btn btn-muted"
                disabled={submitting}
                title="Back to a single task (Esc)"
                onClick={leaveBulk}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting || bulkLines.length === 0}>
                {submitting ? 'Adding…' : `Add ${bulkLines.length || ''}`.trim()}
              </button>
            </div>
          </div>
        </form>
      ) : mode === 'audio' ? (
        <div className="body">
          {text.trim() ? (
            <p className="muted small">
              Title: <strong>{parsed.title || text.trim()}</strong>
            </p>
          ) : null}
          <AudioCapture
            busy={submitting}
            onRecorded={(data, mime) => void saveAudio(data, mime)}
            onCancel={() => {
              setMode('text');
              focusInput('text');
            }}
            onRecordingChange={setRecording}
          />
          {errorBanner}
          {statusLine ? <div className="footer-row"><div />{statusLine}</div> : null}
        </div>
      ) : (
        <form
          className="body"
          aria-busy={submitting}
          onSubmit={(e) => {
            e.preventDefault();
            void saveText();
          }}
        >
          <HighlightedField
            ref={fieldRef}
            className="field-main"
            value={text}
            onChange={(v) => {
              setText(v);
              if (status?.kind === 'error') setStatus(null);
            }}
            highlights={parsed.highlights}
            completions={completions}
            maxRows={5}
            ariaLabel="Task"
            placeholder="Add Task"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                void saveText();
              }
            }}
          >
            {starButton}
          </HighlightedField>
          <PreviewChips chips={chips} />
          {ui === 'minimal' ? null : areaSelect}
          {ui === 'full' ? <p className="muted small">{QUICK_ADD_EXAMPLE}</p> : null}
          {errorBanner}
          {ui === 'minimal' ? (
            statusLine ? <div className="footer-row footer-row-end">{statusLine}</div> : null
          ) : (
            <>
              <div className="footer-row">
                {helpToggle}
                <div className="actions">
                  {statusLine}
                  <button type="button" className="btn btn-muted" disabled={submitting} onClick={hide}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={submitting || !text.trim()} title="Enter">
                    {submitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
              {helpOpen ? <SyntaxHelpContent /> : null}
            </>
          )}
        </form>
      )}
    </div>
  );
}
