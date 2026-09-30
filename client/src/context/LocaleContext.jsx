import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, unwrap } from '../services/api.js';
import { translate } from '../translations/translate.js';
import { formatIndianCurrency, formatIndianDate, formatIndianPhone, formatIndianAddress } from '../utils/india.js';
import { useAuth } from './AuthContext.jsx';

const LocaleContext = createContext(null);
export const supportedLocales = ['en', 'hi', 'ta'];
const languageKeys = { en: 'english', hi: 'hindi', ta: 'tamil' };

export function LocaleProvider({ children }) {
  const { user, updateUser } = useAuth();
  const [locale, setLocale] = useState(() => {
    const saved = window.localStorage.getItem('rentalhub-locale');
    return supportedLocales.includes(saved) ? saved : 'en';
  });
  const [localeSaveError, setLocaleSaveError] = useState(false);

  useEffect(() => {
    window.localStorage.setItem('rentalhub-locale', locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (supportedLocales.includes(user?.preferredLanguage)) setLocale(user.preferredLanguage);
  }, [user?.preferredLanguage]);

  const changeLocale = async (next, retry = false) => {
    if (!supportedLocales.includes(next)) return false;
    setLocale(next);
    window.localStorage.setItem('rentalhub-locale', next);
    setLocaleSaveError(false);
    if (!user || (!retry && user.preferredLanguage === next)) return true;
    try {
      const { data } = await api.patch('/users/me', { preferredLanguage: next });
      const profile = unwrap(data)?.profile ?? unwrap(data);
      if (!profile) throw new Error('The server did not return the updated language preference.');
      updateUser({ ...user, ...profile });
      return true;
    } catch {
      setLocaleSaveError(true);
      return false;
    }
  };

  const value = useMemo(() => ({
    locale,
    setLocale: changeLocale,
    localeSaveError,
    retryLocaleSave: () => changeLocale(locale, true),
    t: (key, values = {}) => translate(locale, key, values),
    formatCurrency: formatIndianCurrency,
    formatDate: (date, options) => formatIndianDate(date, options),
    formatPhone: formatIndianPhone,
    formatAddress: formatIndianAddress,
  }), [locale, localeSaveError, user]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}

export function LanguageSelector() {
  const { locale, setLocale, localeSaveError, retryLocaleSave, t } = useLocale();
  return <div className="language-selector-wrap">
    <label className="language-selector">
      <span className="sr-only">{t('language')}</span>
      <select aria-label={t('language')} value={locale} onChange={(event) => { void setLocale(event.target.value); }}>
        {supportedLocales.map((code) => <option key={code} value={code}>{t(languageKeys[code])}</option>)}
      </select>
    </label>
    {localeSaveError && <span className="language-save-error" role="alert">{t('languageSaveError')} <button type="button" onClick={() => { void retryLocaleSave(); }}>{t('retry')}</button></span>}
  </div>;
}
