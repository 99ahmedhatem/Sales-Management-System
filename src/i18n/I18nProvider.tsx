import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ar } from './ar';

export type Lang = 'en' | 'ar';
const STORAGE_KEY = 'app_lang';

interface I18nValue {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (l: Lang) => void;
  /** t('English text') → Arabic if lang === 'ar' and a translation exists, otherwise the English text. {name} placeholders are filled from vars. */
  t: (text: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue>({ lang: 'en', dir: 'ltr', setLang: () => {}, t: s => s });

function readLang(): Lang {
  try { return localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en'; } catch { return 'en'; }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* storage may be blocked */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nValue>(() => ({
    lang,
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    setLang,
    t: (text, vars) => {
      let out = lang === 'ar' ? ar[text] ?? text : text;
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
      return out;
    },
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

/** Small EN | عربي switch for the top bar. */
export function LanguageSwitch() {
  const { lang, setLang } = useI18n();
  const base = 'px-2 py-1 text-xs transition-colors';
  const on = 'bg-[#dfff03] text-black font-semibold';
  const off = 'text-[#a3a3a3] hover:text-white';
  return (
    <div className="flex items-center rounded-md border border-[#262626] overflow-hidden" role="group" aria-label="Language">
      <button type="button" onClick={() => setLang('en')} className={`${base} ${lang === 'en' ? on : off}`}>EN</button>
      <button type="button" onClick={() => setLang('ar')} className={`${base} ${lang === 'ar' ? on : off}`}>عربي</button>
    </div>
  );
}
