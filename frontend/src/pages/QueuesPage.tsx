import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { addToast } from '../components/Toast';

interface QueuesProps { projectId: string }

const strategies = ['EXPONENTIAL', 'LINEAR', 'FIXED'];

function QueueModal({ queue, onClose, projectId }: { queue?: any; onClose: () => void; projectId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: queue?.name || '',
    description: queue?.description || '',
    priority: queue?.priority ?? 0,
    concurrencyLimit: queue?.concurrencyLimit ?? 10,
    retryStrategy: queue?.retryStrategy || 'EXPONENTIAL',
    maxRetries: queue?.maxRetries ?? 3,
    retryDelayMs: queue?.retryDelayMs ?? 1000,
    retryMaxDelayMs: queue?.retryMaxDelayMs ?? 60000,
    rateLimitPerMin: queue?.rateLimitPerMin || '',
  });

  const save = useMutation({
    mutationFn: () =>
      queue
        ? api.patch(`/queues/${queue.id}`, { ...form, rateLimitPerMin: form.rateLimitPerMin || undefined })
        : api.post('/queues', { ...form, projectId, rateLimitPerMin: form.rateLimitPerMin || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queues'] });
      addToast('success', queue ? 'Queue updated' : 'Queue created');
      onClose();
    },
    onError: () => addToast('error', 'Failed to save queue'),
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{queue ? 'Edit Queue' : 'Create Queue'}</h3>
          <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Queue Name *</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="email-delivery" disabled={!!queue} />
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <input className="form-input" type="number" value={form.priority} onChange={(e) => setForm({...form, priority: parseInt(e.target.value)})} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <input className="form-input" value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} placeholder="What this queue does..." />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Concurrency Limit</label>
              <input className="form-input" type="number" min={1} max={1000} value={form.concurrencyLimit} onChange={(e) => setForm({...form, concurrencyLimit: parseInt(e.target.value)})} />
            </div>
            <div className="form-group">
              <label className="form-label">Max Retries</label>
              <input className="form-input" type="number" min={0} max={100} value={form.maxRetries} onChange={(e) => setForm({...form, maxRetries: parseInt(e.target.value)})} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Retry Strategy</label>
            <select className="form-select" value={form.retryStrategy} onChange={(e) => setForm({...form, retryStrategy: e.target.value})}>
              {strategies.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Initial Retry Delay (ms)</label>
              <input className="form-input" type="number" value={form.retryDelayMs} onChange={(e) => setForm({...form, retryDelayMs: parseInt(e.target.value)})} />
            </div>
            <div className="form-group">
              <label className="form-label">Max Retry Delay (ms)</label>
              <input className="form-input" type="number" value={form.retryMaxDelayMs} onChange={(e) => setForm({...form, retryMaxDelayMs: parseInt(e.target.value)})} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Rate Limit (req/min, optional)</label>
            <input className="form-input" type="number" value={form.rateLimitPerMin} onChange={(e) => setForm({...form, rateLimitPerMin: e.target.value})} placeholder="Leave blank for unlimited" />
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending || !form.name}>
              {save.isPending ? '⏳ Saving...' : queue ? 'Save Changes' : 'Create Queue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function QueuesPage({ projectId }: QueuesProps) {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editQueue, setEditQueue] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['queues', projectId],
    queryFn: () => api.get(`/queues?projectId=${projectId}`).then(r => r.data),
    refetchInterval: 10000,
    enabled: !!projectId,
  });

  const togglePause = useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
      api.post(`/queues/${id}/${paused ? 'resume' : 'pause'}`),
    onSuccess: (_, { paused }) => {
      qc.invalidateQueries({ queryKey: ['queues'] });
      addToast('success', paused ? 'Queue resumed' : 'Queue paused');
    },
  });

  const deleteQueue = useMutation({
    mutationFn: (id: string) => api.delete(`/queues/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queues'] }); addToast('success', 'Queue deleted'); },
    onError: () => addToast('error', 'Cannot delete queue with active jobs'),
  });

  const queues = data?.queues || [];

  return (
    <div className="animate-fade">
      <div className="page-header">
        <div>
          <h1 className="page-title">Queues</h1>
          <p className="page-subtitle">{queues.length} queue{queues.length !== 1 ? 's' : ''} configured</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditQueue(null); setShowModal(true); }}>
          + New Queue
        </button>
      </div>

      {isLoading ? (
        <div className="grid-auto">{[...Array(3)].map((_,i) => <div key={i} className="skeleton" style={{ height: 160 }} />)}</div>
      ) : queues.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <h3>No queues yet</h3>
          <p>Create your first queue to start scheduling jobs</p>
          <button className="btn btn-primary mt-4" onClick={() => setShowModal(true)}>Create Queue</button>
        </div>
      ) : (
        <div className="grid-auto">
          {queues.map((q: any) => (
            <div key={q.id} className={`queue-card ${q.paused ? 'paused' : ''}`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono" style={{ fontWeight: 700, fontSize: 15 }}>{q.name}</span>
                    {q.paused && <span className="badge" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>⏸ PAUSED</span>}
                  </div>
                  {q.description && <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{q.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary btn-xs" onClick={() => { setEditQueue(q); setShowModal(true); }}>Edit</button>
                  <button
                    className={`btn btn-xs ${q.paused ? 'btn-success' : 'btn-secondary'}`}
                    onClick={() => togglePause.mutate({ id: q.id, paused: q.paused })}
                  >
                    {q.paused ? '▶ Resume' : '⏸ Pause'}
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
                {[
                  { label: 'Pending', value: q.stats?.pending, color: 'var(--warning)' },
                  { label: 'Running', value: q.stats?.running, color: 'var(--info)' },
                  { label: 'Completed', value: q.stats?.completed, color: 'var(--success)' },
                  { label: 'Failed', value: q.stats?.failed, color: 'var(--error)' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color }}>{value ?? 0}</div>
                  </div>
                ))}
              </div>

              {/* Config */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>🔢 Concurrency: {q.concurrencyLimit}</span>
                <span>·</span>
                <span>🔄 {q.retryStrategy} retry</span>
                <span>·</span>
                <span>Priority: {q.priority}</span>
                {q.rateLimitPerMin && <><span>·</span><span>⚡ {q.rateLimitPerMin}/min</span></>}
              </div>

              <button
                className="btn btn-danger btn-xs"
                style={{ marginTop: 12 }}
                onClick={() => { if (confirm(`Delete queue "${q.name}"?`)) deleteQueue.mutate(q.id); }}
              >
                🗑 Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <QueueModal
          queue={editQueue}
          projectId={projectId}
          onClose={() => { setShowModal(false); setEditQueue(null); }}
        />
      )}
    </div>
  );
}
