// Automatic reconnect while Mindwtr's Local API can't be reached: wait 0.5 s,
// then 1.5× longer each attempt, up to 30 s between attempts.
import type { ApiErrorCode } from '../preload/api';

const FIRST_DELAY_MS = 500;
const GROWTH = 1.5;
const MAX_DELAY_MS = 30_000;

/** Milliseconds to wait before retry number `attempt` (0-based). */
export function retryDelay(attempt: number): number {
  return Math.min(MAX_DELAY_MS, Math.round(FIRST_DELAY_MS * GROWTH ** Math.max(0, attempt)));
}

/** Errors that can clear up on their own; a missing or wrong token needs the user. */
export function isRetryable(code: ApiErrorCode): boolean {
  return code === 'unreachable' || code === 'http';
}
