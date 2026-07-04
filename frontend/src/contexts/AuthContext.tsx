import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';

interface User { id: string; email: string; name: string; }
interface Org { id: string; name: string; slug: string; role: string; }

interface AuthContextType {
  user: User | null;
  orgs: Org[];
  activeOrg: Org | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, orgName: string) => Promise<void>;
  logout: () => void;
  setActiveOrg: (org: Org) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState<Org | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('jf_token');
    const u = localStorage.getItem('jf_user');
    const o = localStorage.getItem('jf_orgs');
    const ao = localStorage.getItem('jf_active_org');
    if (t && u) {
      setToken(t);
      setUser(JSON.parse(u));
      if (o) setOrgs(JSON.parse(o));
      if (ao) setActiveOrg(JSON.parse(ao));
    }
  }, []);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
    setOrgs(data.organizations);
    const firstOrg = data.organizations[0];
    setActiveOrg(firstOrg);
    localStorage.setItem('jf_token', data.token);
    localStorage.setItem('jf_user', JSON.stringify(data.user));
    localStorage.setItem('jf_orgs', JSON.stringify(data.organizations));
    localStorage.setItem('jf_active_org', JSON.stringify(firstOrg));
  };

  const register = async (name: string, email: string, password: string, orgName: string) => {
    const { data } = await api.post('/auth/register', { name, email, password, orgName });
    setToken(data.token);
    setUser(data.user);
    const org = { ...data.organization, role: 'OWNER' };
    setOrgs([org]);
    setActiveOrg(org);
    localStorage.setItem('jf_token', data.token);
    localStorage.setItem('jf_user', JSON.stringify(data.user));
    localStorage.setItem('jf_orgs', JSON.stringify([org]));
    localStorage.setItem('jf_active_org', JSON.stringify(org));
  };

  const logout = () => {
    setUser(null); setOrgs([]); setActiveOrg(null); setToken(null);
    localStorage.removeItem('jf_token');
    localStorage.removeItem('jf_user');
    localStorage.removeItem('jf_orgs');
    localStorage.removeItem('jf_active_org');
    window.location.href = '/login';
  };

  const handleSetActiveOrg = (org: Org) => {
    setActiveOrg(org);
    localStorage.setItem('jf_active_org', JSON.stringify(org));
  };

  return (
    <AuthContext.Provider value={{ user, orgs, activeOrg, token, login, register, logout, setActiveOrg: handleSetActiveOrg }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
