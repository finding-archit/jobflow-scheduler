import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { formatDistanceToNow } from 'date-fns';

interface WorkersProps { projectId: string }

function WorkerStatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    IDLE: 'var(--success)', BUSY: 'var(--info)', DRAINING: 'var(--warning)', OFFLINE: 'var(--text-muted)',
  };
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: colors[status] || 'var(--text-muted)',
      boxShadow: status === 'BUSY' ? '0 0 8px var(--info)' : undefined,
    }} />
  );
}

function MemBar({ pct }: { pct: number }) {
  const color = pct > 80 ? 'var(--error)' : pct > 60 ? 'var(--warning)' : 'var(--success)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
        <span>Memory</span><span>{pct.toFixed(0)}%</span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export function WorkersPage({ projectId }: WorkersProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['workers', projectId],
    queryFn: () => api.get(`/workers?projectId=${projectId}`).then(r => r.data),
    refetchInterval: 5000,
    enabled: !!projectId,
  });

  const workers = data?.workers || [];
  const online = workers.filter((w: any) => w.status !== 'OFFLINE');
  const offline = workers.filter((w: any) => w.status === 'OFFLINE');

  return (
    <div className="animate-fade">
      <div className="page-header">
        <div>
          <h1 className="page-title">Workers</h1>
          <p className="page-subtitle">{online.length} active · {offline.length} offline</p>
        </div>
        <span className="live-dot">Live</span>
      </div>

      {/* Summary */}
      <div className="grid-4 mb-6">
        <div className="stat-card">
          <span className="stat-icon">🖥️</span>
          <div className="stat-label">Total Workers</div>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>{workers.length}</div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">✅</span>
          <div className="stat-label">Active</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{online.length}</div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">🔄</span>
          <div className="stat-label">Busy</div>
          <div className="stat-value" style={{ color: 'var(--info)' }}>{workers.filter((w: any) => w.status === 'BUSY').length}</div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">💤</span>
          <div className="stat-label">Offline</div>
          <div className="stat-value" style={{ color: 'var(--text-muted)' }}>{offline.length}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid-auto">{[...Array(4)].map((_,i) => <div key={i} className="skeleton" style={{ height: 200 }} />)}</div>
      ) : workers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🖥️</div>
          <h3>No workers registered</h3>
          <p>Start a worker with: <code className="font-mono">npm run worker</code></p>
        </div>
      ) : (
        <div className="grid-auto">
          {workers.map((w: any) => {
            const hb = w.heartbeats?.[0];
            const isOnline = w.status !== 'OFFLINE';
            const memPct = hb?.memoryMb ? Math.min((hb.memoryMb / 1024) * 100, 100) : 0;

            return (
              <div key={w.id} className={`worker-card ${isOnline ? 'online' : 'offline'}`}>
                {/* Header */}
                <div className="flex items-center gap-2 mb-3">
                  <WorkerStatusDot status={w.status} />
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{w.hostname}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                    <span className={`badge badge-${w.status.toLowerCase()}`} style={{ fontSize: 10 }}>{w.status}</span>
                  </span>
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  PID {w.pid} · Concurrency {w.concurrency}
                </div>

                {/* Jobs running */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span className="text-muted">Running Jobs</span>
                    <span style={{ fontWeight: 700, color: 'var(--info)' }}>{hb?.jobsRunning ?? 0} / {w.concurrency}</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${((hb?.jobsRunning || 0) / w.concurrency) * 100}%` }} />
                  </div>
                </div>

                {hb?.memoryMb && <MemBar pct={memPct} />}

                <div className="divider" />

                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {w.lastHeartbeatAt
                    ? `Last seen ${formatDistanceToNow(new Date(w.lastHeartbeatAt), { addSuffix: true })}`
                    : 'Never connected'
                  }
                </div>

                {w.queueIds?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {w.queueIds.map((qid: string) => (
                      <span key={qid} style={{ fontSize: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {qid.slice(0,8)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
