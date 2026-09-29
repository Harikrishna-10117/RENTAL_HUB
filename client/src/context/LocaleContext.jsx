import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { messages } from '../lib/messages.js';
import { formatIndianCurrency, formatIndianDate, formatIndianPhone, formatIndianAddress } from '../lib/india.js';

const LocaleContext = createContext(null);
const supportedLocales = ['en', 'hi', 'ta'];
const languageKeys = { en: 'english', hi: 'hindi', ta: 'tamil' };

export function LocaleProvider({ children }) {
  const [locale, setLocale] = useState(() => {
    const saved = window.localStorage.getItem('rentalhub-locale');
    return supportedLocales.includes(saved) ? saved : 'en';
  });

  useEffect(() => {
    window.localStorage.setItem('rentalhub-locale', locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({
    locale,
    setLocale: (next) => { if (supportedLocales.includes(next)) setLocale(next); },
    t: (key, values = {}) => {
      const template = messages[locale]?.[key] ?? messages.en[key] ?? key;
      return template.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
    },
    formatCurrency: formatIndianCurrency,
    formatDate: (date, options) => formatIndianDate(date, options),
    formatPhone: formatIndianPhone,
    formatAddress: formatIndianAddress,
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}

export function LanguageSelector() {
  const { locale, setLocale, t } = useLocale();
  return <label className="language-selector">
    <span className="sr-only">{t('language')}</span>
    <select aria-label={t('language')} value={locale} onChange={(event) => setLocale(event.target.value)}>
      {supportedLocales.map((code) => <option key={code} value={code}>{t(languageKeys[code])}</option>)}
    </select>
  </label>;
}
