// Audio mode: record with MediaRecorder, hand the bytes to main (saved under
// userData/recordings/), then the parent creates a task with a `kind: 'file'`
// attachment pointing at that file. No speech-to-text.
import { useEffect, useRef, useState } from 'react';

export const MAX_RECORDING_SECONDS = 300;

interface Props {
  busy: boolean;
  onRecorded: (data: ArrayBuffer, mimeType: string) => void;
  onCancel: () => void;
  onRecordingChange: (recording: boolean) => void;
}

function pickMimeType(): string {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function audioUnsupportedReason(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'Audio recording is not available here.';
  }
  return undefined;
}

export function AudioCapture({ busy, onRecorded, onCancel, onRecordingChange }: Props) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const discardRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
    return () => {
      discardRef.current = true;
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    onRecordingChange(recording);
  }, [recording, onRecordingChange]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_RECORDING_SECONDS) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (discardRef.current) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        if (blob.size === 0) {
          setError('Nothing was recorded.');
          return;
        }
        onRecorded(await blob.arrayBuffer(), blob.type.split(';')[0]);
      };
      recorderRef.current = recorder;
      discardRef.current = false;
      recorder.start(1000);
      setSeconds(0);
      setRecording(true);
    } catch (err) {
      const name = (err as DOMException)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in Windows Settings → Privacy & security → Microphone.'
          : name === 'NotFoundError'
            ? 'No microphone found.'
            : `Couldn't start recording: ${String((err as Error)?.message ?? err)}`,
      );
    } finally {
      setStarting(false);
    }
  };

  const stop = () => recorderRef.current?.state === 'recording' && recorderRef.current.stop();

  const cancel = () => {
    discardRef.current = true;
    stop();
    onCancel();
  };

  const label = busy ? 'Saving…' : recording ? 'Stop' : starting ? '…' : 'Record';
  const mm = String(Math.floor(seconds / 60));
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="audio">
      <button
        ref={buttonRef}
        type="button"
        className={`record-button${recording ? ' recording' : ''}`}
        aria-disabled={busy || starting}
        onClick={() => {
          if (busy || starting) return;
          if (recording) stop();
          else void start();
        }}
      >
        {label}
      </button>
      <div className="audio-status" aria-live="polite">
        {recording
          ? `Recording ${mm}:${ss} (max ${MAX_RECORDING_SECONDS / 60} min). Click Stop or press Enter to save.`
          : busy
            ? 'Saving the recording and creating the task…'
            : 'Click Record to capture a voice note. It is attached to a new task as an audio file.'}
      </div>
      {error ? <div className="error-text" role="alert">{error}</div> : null}
      <div className="audio-cancel">
        <button type="button" className="btn btn-muted" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
