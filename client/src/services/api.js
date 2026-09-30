import axios from 'axios';
import { messages } from '../translations/index.js';

const errorTranslationKeys = {
  AUTH_REQUIRED: 'errorAuthRequired',
  INVALID_TOKEN: 'errorAuthRequired',
  SESSION_REVOKED: 'errorAuthRequired',
  FORBIDDEN: 'errorForbidden',
  INVALID_CREDENTIALS: 'errorInvalidCredentials',
  EMAIL_IN_USE: 'errorEmailInUse',
  PHONE_IN_USE: 'errorPhoneInUse',
  VALIDATION_ERROR: 'errorValidation',
  INVALID_ID: 'errorValidation',
  NOT_FOUND: 'errorNotFound',
  DATES_UNAVAILABLE: 'errorDatesUnavailable',
  RATE_LIMITED: 'errorRateLimited',
  ROUTE_NOT_FOUND: 'errorNotFound',
  INTERNAL_ERROR: 'errorGeneric'
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('rentalhub_token');
  const locale = localStorage.getItem('rentalhub-locale');
  if (locale) config.headers['Accept-Language'] = locale;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase())) {
    config.headers['Idempotency-Key'] ||= crypto.randomUUID();
  }
  return config;
});

export function getErrorMessage(error) {
  const locale = typeof localStorage === 'undefined' ? 'en' : localStorage.getItem('rentalhub-locale');
  const code = error?.response?.data?.errorCode;
  const translationKey = errorTranslationKeys[code];
  if (translationKey && messages[locale]?.[translationKey]) return messages[locale][translationKey];
  return error?.response?.data?.message
    || error?.response?.data?.error
    || error?.message
    || messages[locale]?.errorGeneric
    || messages.en.errorGeneric;
}

export function unwrap(data) {
  if (data == null) return null;
  return data.data ?? data.result ?? data;
}

export function asList(value) {
  const result = unwrap(value);
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.results)) return result.results;
  return [];
}
