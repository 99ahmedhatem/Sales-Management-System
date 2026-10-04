import type { Lang } from './I18nProvider';

/** Locale for toLocale*String: Arabic month/day names with Latin digits, or US English. */
export const dateLocale = (lang: Lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US');
