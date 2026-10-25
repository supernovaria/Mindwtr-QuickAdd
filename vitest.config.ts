// Tests run from the repo root. Without this file vitest would fall back to
// vite.config.ts, whose `root` is src/renderer, and find no tests elsewhere.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    root: import.meta.dirname,
    test: {
        include: ['src/**/*.test.{ts,tsx}'],
    },
});
