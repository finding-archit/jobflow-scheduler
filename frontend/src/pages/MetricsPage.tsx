import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { format } from 'date-fns';

interface MetricsProps { projectId: string }

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color || p.fill }}>{p.name}: <strong>{p.value}</strong></p>
      ))}
    </div>
  );
};

export function MetricsPage({ projectId }: MetricsProps) {
  const [hours, setHours] = useState(24);

  const { data, isLoading } = useQuery({
    queryKey: ['metrics', projectId, hours],
    queryFn: () => api.get(`/metrics?projectId=${projectId}&hours=${hours}`).then(r => r.data),
    refetchInterval: 30000,
    enabled: !!projectId,
  });

  const s = data?.summary;
  const throughput = (data?.throughput || []).map((d: any) => ({
    ...d,
    time: format(new Date(d.timestamp), 'HH:mm'),
  }));
  const queueBreakdown = data?.queueBreakdown || [];

  const pieData = s ? [
    { name: 'Completed', value: s.completedJobs },
    { name: 'Failed', value: s.failedJobs },
    { name: 'Queued', value: s.queuedJobs },
    { name: 'Running', value: s.runningJobs },
    { name: 'Dead', value: s.deadJobs },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="animate-fade">
      <div className="page-header">
        <div>
          <h1 className="page-title">Metrics</h1>
          <p className="page-subtitle">Job throughput and system performance</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[6, 24, 48, 168].map((h) => (
            <button key={h} className={`btn btn-sm ${hours === h ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setHours(h)}>
              {h < 24 ? `${h}h` : h === 168 ? '7d' : `${h}h`}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid-4 mb-6">
        <div className="stat-card">
          <span className="stat-icon">✅</span>
          <div className="stat-label">Success Rate</div>
          <div className="stat-value" style={{ color: s?.successRate > 90 ? 'var(--success)' : s?.successRate > 70 ? 'var(--warning)' : 'var(--error)' }}>
            {s?.successRate ?? '—'}%
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">⏱️</span>
          <div className="stat-label">Avg Duration</div>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>{s ? `${(s.avgDurationMs / 1000).toFixed(1)}s` : '—'}</div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">⚡</span>
          <div className="stat-label">Total Processed</div>
          <div className="stat-value" style={{ color: 'var(--purple)' }}>{s ? s.completedJobs + s.failedJobs : '—'}</div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">💀</span>
          <div className="stat-label">Dead Jobs</div>
          <div className="stat-value" style={{ color: 'var(--error)' }}>{s?.deadJobs ?? '—'}</div>
        </div>
      </div>

      {/* Charts row 1 */}
      <div className="grid-2 mb-6">
        <div className="chart-wrapper">
          <div className="chart-title">Job Throughput</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={throughput}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fill: '#525670', fontSize: 11 }} />
              <YAxis tick={{ fill: '#525670', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="completed" name="Completed" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-wrapper">
          <div className="chart-title">Job Status Distribution</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-queue bar chart */}
      <div className="chart-wrapper mb-6">
        <div className="chart-title">Per-Queue Job Counts</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={queueBreakdown}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
            <XAxis dataKey="queueName" tick={{ fill: '#525670', fontSize: 11 }} />
            <YAxis tick={{ fill: '#525670', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[4,4,0,0]} />
            <Bar dataKey="running" name="Running" fill="#3b82f6" radius={[4,4,0,0]} />
            <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[4,4,0,0]} />
            <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Queue details table */}
      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Queue Performance</h3>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Queue</th>
                <th>Pending</th>
                <th>Running</th>
                <th>Completed</th>
                <th>Failed</th>
                <th>Success Rate</th>
              </tr>
            </thead>
            <tbody>
              {queueBreakdown.map((q: any) => {
                const total = q.completed + q.failed;
                const rate = total > 0 ? Math.round((q.completed / total) * 100) : 100;
                return (
                  <tr key={q.queueId}>
                    <td><span className="font-mono" style={{ fontWeight: 600 }}>{q.queueName}</span></td>
                    <td style={{ color: 'var(--warning)', fontWeight: 600 }}>{q.pending}</td>
                    <td style={{ color: 'var(--info)', fontWeight: 600 }}>{q.running}</td>
                    <td style={{ color: 'var(--success)', fontWeight: 600 }}>{q.completed}</td>
                    <td style={{ color: 'var(--error)', fontWeight: 600 }}>{q.failed}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="progress-bar" style={{ width: 60 }}>
                          <div className="progress-fill" style={{ width: `${rate}%`, background: rate > 80 ? 'var(--success)' : rate > 50 ? 'var(--warning)' : 'var(--error)' }} />
                        </div>
                        <span style={{ fontSize: 12 }}>{rate}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
