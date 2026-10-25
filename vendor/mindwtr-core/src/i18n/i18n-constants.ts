import type { Language } from './i18n-types';
import { LOCALES } from './i18n-locales';

export const LANGUAGE_STORAGE_KEY = 'mindwtr-language';
export const SUPPORTED_LANGUAGES: Language[] = ['en', ...Object.keys(LOCALES) as Language[]];

export const isSupportedLanguage = (value: string | null | undefined): value is Language =>
    Boolean(value && SUPPORTED_LANGUAGES.includes(value as Language));
