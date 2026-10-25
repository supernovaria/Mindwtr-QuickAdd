import type { QuickAddBridge } from '../preload/api';
import { createMockBridge } from './mock-bridge';

declare global {
  interface Window {
    quickAdd?: QuickAddBridge;
  }
}

/** The preload bridge in Electron; an in-memory mock in a plain browser tab (`npm run dev:web`). */
export const bridge: QuickAddBridge = window.quickAdd ?? createMockBridge();
