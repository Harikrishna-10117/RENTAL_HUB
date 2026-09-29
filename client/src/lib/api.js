import axios from 'axios';

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
  return error?.response?.data?.message
    || error?.response?.data?.error
    || error?.message
    || 'Something went wrong. Please try again.';
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
