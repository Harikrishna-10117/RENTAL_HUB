import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, unwrap } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rentalhub_user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('rentalhub_token')));

  useEffect(() => {
    if (!localStorage.getItem('rentalhub_token')) {
      setLoading(false);
      return;
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
        localStorage.removeItem('rentalhub_token');
        localStorage.removeItem('rentalhub_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    async login(credentials) {
      const { data } = await api.post('/auth/login', credentials);
      const result = unwrap(data);
      const token = result?.token ?? result?.accessToken;
      const currentUser = result?.user ?? result?.profile;
      if (!token || !currentUser) throw new Error('The server response did not include a user and access token.');
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
        localStorage.setItem('rentalhub_token', token);
        localStorage.setItem('rentalhub_user', JSON.stringify(currentUser));
        setUser(currentUser);
      }
      return currentUser;
    },
    logout() {
      localStorage.removeItem('rentalhub_token');
      localStorage.removeItem('rentalhub_user');
      setUser(null);
    },
    updateUser(nextUser) {
      localStorage.setItem('rentalhub_user', JSON.stringify(nextUser));
      setUser(nextUser);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function userRole(user) {
  return String(user?.role ?? user?.userType ?? '').toLowerCase();
}
