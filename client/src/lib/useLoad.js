import { useCallback, useEffect, useState } from 'react';
import { api, asList, getErrorMessage, unwrap } from './api.js';

export function useLoad(path, options = {}) {
  const [data, setData] = useState(options.initial ?? null);
  const [loading, setLoading] = useState(options.enabled !== false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get(path);
      setData(options.list ? asList(response.data) : unwrap(response.data));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [path, options.list]);
  useEffect(() => { if (options.enabled !== false) load(); }, [load, options.enabled]);
  return { data, setData, loading, error, reload: load };
}
