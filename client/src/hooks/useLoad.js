import { useQuery } from '@tanstack/react-query';
import { api, asList, getErrorMessage, unwrap } from '../services/api.js';

export function useLoad(path, options = {}) {
  const enabled = options.enabled !== false;
  const query = useQuery({
    queryKey: ['api', path, options.list ? 'list' : 'item'],
    queryFn: async () => {
      const { data } = await api.get(path);
      return options.list ? asList(data) : unwrap(data);
    },
    enabled,
    placeholderData: options.initial,
  });

  return {
    data: query.data ?? options.initial ?? null,
    loading: enabled && query.isLoading,
    error: query.error ? getErrorMessage(query.error) : '',
    reload: () => query.refetch({ throwOnError: true }).then(({ data }) => data),
  };
}
