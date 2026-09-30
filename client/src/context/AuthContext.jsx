import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rentalhub_user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('rentalhub_token')));

  useEffect(() => {
    const syncSession = (event) => {
      if (event.key !== 'rentalhub_token' && event.key !== 'rentalhub_user') return;
      queryClient.clear();
      const token = localStorage.getItem('rentalhub_token');
      if (!token) {
        localStorage.removeItem('rentalhub_user');
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        setUser(JSON.parse(localStorage.getItem('rentalhub_user') || 'null'));
      } catch {
        setUser(null);
      }
    };
    window.addEventListener('storage', syncSession);
    if (!localStorage.getItem('rentalhub_token')) {
      setLoading(false);
      return () => window.removeEventListener('storage', syncSession);
    }
    api.get('/auth/me')
      .then(({ data }) => {
        const currentUser = unwrap(data)?.user ?? unwrap(data);
        if (currentUser) {
          setUser(currentUser);
          localStorage.setItem('rentalhub_user', JSON.stringify(currentUser));
        }
      })
      .catch(() => {
        queryClient.clear();
        localStorage.removeItem('rentalhub_token');
        localStorage.removeItem('rentalhub_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
    return () => window.removeEventListener('storage', syncSession);
  }, [queryClient]);

  const value = useMemo(() => ({
    user,
    loading,
    async login(credentials) {
      const { data } = await api.post('/auth/login', credentials);
      const result = unwrap(data);
      const token = result?.token ?? result?.accessToken;
      const currentUser = result?.user ?? result?.profile;
      if (!token || !currentUser) throw new Error('The server response did not include a user and access token.');
      queryClient.clear();
      localStorage.setItem('rentalhub_token', token);
      localStorage.setItem('rentalhub_user', JSON.stringify(currentUser));
      setUser(currentUser);
      return currentUser;
    },
    async register(details) {
      const { data } = await api.post('/auth/register', details);
      const result = unwrap(data);
      const token = result?.token ?? result?.accessToken;
      const currentUser = result?.user ?? result?.profile;
      if (token && currentUser) {
        queryClient.clear();
        localStorage.setItem('rentalhub_token', token);
        localStorage.setItem('rentalhub_user', JSON.stringify(currentUser));
        setUser(currentUser);
      }
      return currentUser;
    },
    async logout() {
      let logoutError;
      try {
        if (localStorage.getItem('rentalhub_token')) await api.post('/auth/logout');
      } catch (error) {
        logoutError = error;
      } finally {
        queryClient.clear();
        localStorage.removeItem('rentalhub_token');
        localStorage.removeItem('rentalhub_user');
        setUser(null);
      }
      if (logoutError) throw logoutError;
    },
    updateUser(nextUser) {
      localStorage.setItem('rentalhub_user', JSON.stringify(nextUser));
      setUser(nextUser);
    },
  }), [user, loading, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function userRole(user) {
  const role = String(user?.role ?? user?.userType ?? '').toLowerCase();
  return role === 'inspector' ? 'transporter' : role;
}
