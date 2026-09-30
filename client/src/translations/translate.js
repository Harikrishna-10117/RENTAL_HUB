import { messages } from './messages.js';

export function translate(locale, key, values = {}) {
  const template = messages[locale]?.[key] ?? messages.en[key];
  if (!template) {
    if (import.meta.env?.DEV) console.warn(`Missing translation: ${locale}.${key}`);
    return key;
  }
  return template.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
}
