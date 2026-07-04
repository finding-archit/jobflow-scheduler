import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/queues', label: 'Queues', icon: '📋' },
  { path: '/jobs', label: 'Jobs', icon: '⚡' },
  { path: '/workers', label: 'Workers', icon: '🖥️' },
  { path: '/metrics', label: 'Metrics', icon: '📈' },
  { path: '/dlq', label: 'Dead Letter Queue', icon: '💀', badgeKey: 'dlq' },
];

interface SidebarProps {
  wsConnected: boolean;
  dlqCount?: number;
  activeProject?: { id: string; name: string } | null;
  projects?: { id: string; name: string }[];
  onProjectChange?: (id: string) => void;
}

export function Sidebar({ wsConnected, dlqCount, activeProject, projects = [], onProjectChange }: SidebarProps) {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">⚡</div>
        <span className="sidebar-logo-text">JobFlow</span>
      </div>

      {/* Project selector */}
      {projects.length > 0 && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="form-label" style={{ marginBottom: 6, fontSize: 11 }}>PROJECT</div>
          <select
            className="form-select"
            style={{ fontSize: 12, padding: '6px 10px' }}
            value={activeProject?.id || ''}
            onChange={(e) => onProjectChange?.(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Navigation */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Navigation</div>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
          >
            <span className="sidebar-item-icon">{item.icon}</span>
            {item.label}
            {item.badgeKey === 'dlq' && dlqCount && dlqCount > 0 && (
              <span className="sidebar-badge">{dlqCount}</span>
            )}
          </NavLink>
        ))}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        {/* WS status */}
        <div className={`ws-status ${wsConnected ? 'connected' : 'disconnected'}`} style={{ marginBottom: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: wsConnected ? 'var(--success)' : 'var(--text-muted)', display: 'inline-block' }} />
          {wsConnected ? 'Live updates on' : 'Connecting...'}
        </div>

        <div className="user-info">
          <div className="user-avatar">{user?.name?.charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="user-name truncate">{user?.name}</div>
            <div className="user-email truncate">{user?.email}</div>
          </div>
          <button
            onClick={logout}
            className="btn btn-secondary btn-xs"
            title="Logout"
          >
            ↪
          </button>
        </div>
      </div>
    </aside>
  );
}
