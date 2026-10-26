import { describe, expect, test } from 'vitest';
import { isRetryable, retryDelay } from './retry';

describe('retryDelay', () => {
  test('starts at 0.5 s and grows 1.5× per attempt', () => {
    expect([0, 1, 2, 3, 4].map(retryDelay)).toEqual([500, 750, 1125, 1688, 2531]);
  });
  test('caps at 30 s', () => {
    expect(retryDelay(11)).toBe(30_000);
    expect(retryDelay(100)).toBe(30_000);
  });
});

describe('isRetryable', () => {
  test('connection and server errors retry; token problems wait for the user', () => {
    expect(isRetryable('unreachable')).toBe(true);
    expect(isRetryable('http')).toBe(true);
    expect(isRetryable('no-token')).toBe(false);
    expect(isRetryable('unauthorized')).toBe(false);
    expect(isRetryable('read-only')).toBe(false);
  });
});
