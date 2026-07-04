import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { addToast } from '../components/Toast';
import { format } from 'date-fns';

interface DLQProps { projectId: string }

export function DLQPage({ projectId }: DLQProps) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['dlq', projectId],
    queryFn: () => api.get(`/dlq?projectId=${projectId}&resolved=false`).then(r => r.data),
    refetchInterval: 15000,
    enabled: !!projectId,
  });

  const requeue = useMutation({
    mutationFn: (id: string) => api.post(`/dlq/${id}/requeue`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dlq'] }); addToast('success', 'Job re-queued from DLQ'); },
    onError: () => addToast('error', 'Failed to requeue job'),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/dlq/${id}/resolve`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dlq'] }); addToast('success', 'Entry resolved'); },
  });

  const entries = data?.entries || [];

  return (
    <div className="animate-fade">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dead Letter Queue</h1>
          <p className="page-subtitle">{entries.length} unresolved entries — permanently failed jobs</p>
        </div>
      </div>

      {entries.length > 0 && (
        <div style={{ padding: '12px 16px', background: 'var(--error-soft)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, marginBottom: 20, fontSize: 13, color: 'var(--error)' }}>
          ⚠️ <strong>{entries.length} job{entries.length > 1 ? 's' : ''}</strong> have permanently failed and require attention
        </div>
      )}

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[...Array(3)].map((_,i) => <div key={i} className="skeleton" style={{ height: 100 }} />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎉</div>
          <h3>Dead Letter Queue is empty</h3>
          <p>All jobs are processing successfully</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {entries.map((e: any) => (
            <div key={e.id} className="card" style={{ borderColor: 'rgba(239,68,68,0.2)' }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{e.job?.type}</div>
                  <div className="font-mono text-muted" style={{ fontSize: 11 }}>{e.jobId}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-success btn-sm" onClick={() => requeue.mutate(e.id)}>↺ Re-queue</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => resolve.mutate(e.id)}>✓ Resolve</button>
                </div>
              </div>

              <div className="grid-2" style={{ gap: 12, marginBottom: 12 }}>
                <div>
                  <div className="form-label">Queue</div>
                  <span className="font-mono" style={{ fontSize: 13 }}>{e.job?.queue?.name}</span>
                </div>
                <div>
                  <div className="form-label">Failure Count</div>
                  <span style={{ color: 'var(--error)', fontWeight: 700 }}>{e.failureCount} attempts</span>
                </div>
                <div>
                  <div className="form-label">Failed At</div>
                  <span style={{ fontSize: 12 }}>{format(new Date(e.failedAt), 'MMM d, yyyy HH:mm')}</span>
                </div>
              </div>

              <div style={{ padding: '8px 12px', background: 'var(--error-soft)', borderRadius: 8, fontSize: 12 }}>
                <strong style={{ color: 'var(--error)' }}>Error: </strong>
                <span style={{ color: 'var(--text-secondary)' }}>{e.reason}</span>
              </div>

              {e.lastError && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>Full stack trace</summary>
                  <div className="log-viewer" style={{ marginTop: 8, fontSize: 11, maxHeight: 150 }}>
                    <pre style={{ color: 'var(--error)', opacity: 0.8 }}>{e.lastError}</pre>
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
