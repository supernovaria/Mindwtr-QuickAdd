import type { Locale } from './i18n-locales';

// 'en' plus every locale in the LOCALES table (i18n-locales.ts) — see that file's header
// comment for why English is bundled directly rather than being a table entry.
export type Language = 'en' | Locale;
