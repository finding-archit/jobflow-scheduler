import React, { useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { format } from 'date-fns';
import { useWebSocket } from '../hooks/useWebSocket';

interface DashboardProps { projectId: string }

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: <strong>{p.value}</strong></p>
      ))}
    </div>
  );
};

export function DashboardPage({ projectId }: DashboardProps) {
  const { lastEvent } = useWebSocket(projectId);

  const { data: metrics, refetch: refetchMetrics } = useQuery({
    queryKey: ['metrics', projectId],
    queryFn: () => api.get(`/metrics?projectId=${projectId}&hours=24`).then(r => r.data),
    refetchInterval: 15000,
    enabled: !!projectId,
  });

  const { data: sysHealth } = useQuery({
    queryKey: ['system-health', projectId],
    queryFn: () => api.get(`/metrics/system?projectId=${projectId}`).then(r => r.data),
    refetchInterval: 10000,
    enabled: !!projectId,
  });

  // Refetch on WS events
  useEffect(() => {
    if (lastEvent) refetchMetrics();
  }, [lastEvent]);

  const s = metrics?.summary;
  const throughput = metrics?.throughput || [];
  const queueBreakdown = metrics?.queueBreakdown || [];

  return (
    <div className="animate-fade">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">System health & real-time throughput overview</p>
        </div>
        <span className="live-dot">Live</span>
      </div>

      {/* Summary cards */}
      <div className="grid-4 mb-6">
        <StatCard label="Total Jobs" value={s?.totalJobs ?? '—'} icon="⚡" color="var(--accent)" />
        <StatCard label="Completed" value={s?.completedJobs ?? '—'} icon="✅" color="var(--success)" sub={s ? `${s.successRate}% success rate` : undefined} />
        <StatCard label="Running" value={s?.runningJobs ?? '—'} icon="🔄" color="var(--info)" />
        <StatCard label="Failed / Dead" value={s ? s.failedJobs + s.deadJobs : '—'} icon="❌" color="var(--error)" />
      </div>

      <div className="grid-4 mb-6">
        <StatCard label="Queued" value={s?.queuedJobs ?? '—'} icon="📋" color="var(--warning)" />
        <StatCard label="Active Workers" value={sysHealth?.workers?.active ?? '—'} icon="🖥️" color="var(--purple)" />
        <StatCard label="Avg Duration" value={s ? `${(s.avgDurationMs / 1000).toFixed(1)}s` : '—'} icon="⏱️" color="var(--accent)" />
        <StatCard label="DLQ Unresolved" value={sysHealth?.deadLetterQueue?.unresolved ?? '—'} icon="💀" color="var(--error)" />
      </div>

      {/* Charts */}
      <div className="grid-2 mb-6">
        <div className="chart-wrapper">
          <div className="chart-title">Throughput (24h)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={throughput}>
              <defs>
                <linearGradient id="cGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="cRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tickFormatter={(v) => format(new Date(v), 'HH:mm')} tick={{ fill: '#525670', fontSize: 11 }} />
              <YAxis tick={{ fill: '#525670', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="completed" name="Completed" stroke="#10b981" fill="url(#cGreen)" strokeWidth={2} />
              <Area type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" fill="url(#cRed)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-wrapper">
          <div className="chart-title">Queue Depth by Queue</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={queueBreakdown} layout="vertical">
              <CartesianGrid stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" tick={{ fill: '#525670', fontSize: 11 }} />
              <YAxis dataKey="queueName" type="category" tick={{ fill: '#525670', fontSize: 11 }} width={120} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[0,3,3,0]} />
              <Bar dataKey="running" name="Running" fill="#3b82f6" radius={[0,3,3,0]} />
              <Bar dataKey="completed" name="Completed (24h)" fill="#10b981" radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Queue health table */}
      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Queue Health</h3>
        {queueBreakdown.length === 0 ? (
          <div className="empty-state"><p>No queues found. Create a queue to get started.</p></div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Pending</th>
                  <th>Running</th>
                  <th>Completed</th>
                  <th>Failed</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {queueBreakdown.map((q: any) => {
                  const total = q.completed + q.failed;
                  const health = total > 0 ? Math.round((q.completed / total) * 100) : 100;
                  return (
                    <tr key={q.queueId}>
                      <td><span className="font-mono" style={{ fontSize: 13 }}>{q.queueName}</span></td>
                      <td><span style={{ color: 'var(--warning)', fontWeight: 600 }}>{q.pending}</span></td>
                      <td><span style={{ color: 'var(--info)', fontWeight: 600 }}>{q.running}</span></td>
                      <td><span style={{ color: 'var(--success)', fontWeight: 600 }}>{q.completed}</span></td>
                      <td><span style={{ color: 'var(--error)', fontWeight: 600 }}>{q.failed}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="progress-bar" style={{ width: 80 }}>
                            <div className="progress-fill" style={{ width: `${health}%`, background: health > 80 ? 'var(--success)' : health > 50 ? 'var(--warning)' : 'var(--error)' }} />
                          </div>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{health}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color, sub }: { label: string; value: any; icon: string; color: string; sub?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-icon">{icon}</span>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
