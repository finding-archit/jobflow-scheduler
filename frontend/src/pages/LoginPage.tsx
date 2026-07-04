import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { addToast } from '../components/Toast';

export function LoginPage() {
  const { login } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: 'demo@jobflow.dev', password: 'password123', orgName: '' });
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(form.email, form.password);
    } catch {
      addToast('error', 'Invalid credentials. Try demo@jobflow.dev / password123');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(form.name, form.email, form.password, form.orgName);
      addToast('success', 'Account created! Welcome to JobFlow.');
    } catch {
      addToast('error', 'Registration failed. Email may already exist.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚡</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginBottom: 4 }}>JobFlow</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Distributed Job Scheduling Platform
          </p>
        </div>

        {/* Tabs */}
        <div className="tab-nav" style={{ marginBottom: 24 }}>
          <button className={`tab-item ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>Sign In</button>
          <button className={`tab-item ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>Create Account</button>
        </div>

        {tab === 'login' ? (
          <form onSubmit={handleLogin}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  className="form-input"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  required
                />
              </div>
              <button className="btn btn-primary w-full" type="submit" disabled={loading}>
                {loading ? '⏳ Signing in...' : '→ Sign In'}
              </button>
            </div>
            <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <strong>Demo credentials:</strong><br />
              demo@jobflow.dev / password123
            </div>
          </form>
        ) : (
          <form onSubmit={handleRegister}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input className="form-input" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" required />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" required />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 characters" required />
              </div>
              <div className="form-group">
                <label className="form-label">Organization Name</label>
                <input className="form-input" type="text" value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} placeholder="Acme Corp" required />
              </div>
              <button className="btn btn-primary w-full" type="submit" disabled={loading}>
                {loading ? '⏳ Creating...' : '→ Create Account'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
