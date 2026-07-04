import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { addToast } from '../components/Toast';
import { formatDistanceToNow, format } from 'date-fns';

interface JobsProps { projectId: string }

const STATUS_OPTIONS = ['', 'QUEUED', 'SCHEDULED', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD', 'CANCELLED'];

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{status}</span>;
}

function JobDrawer({ job, onClose, onRefresh }: { job: any; onClose: () => void; onRefresh: () => void }) {
  const { data: detail } = useQuery({
    queryKey: ['job-detail', job.id],
    queryFn: () => api.get(`/jobs/${job.id}`).then(r => r.data.job),
    refetchInterval: 5000,
  });
  const qc = useQueryClient();
  const j = detail || job;

  const cancel = useMutation({
    mutationFn: () => api.post(`/jobs/${j.id}/cancel`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jobs'] }); addToast('success', 'Job cancelled'); onRefresh(); },
  });
  const retry = useMutation({
    mutationFn: () => api.post(`/jobs/${j.id}/retry`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jobs'] }); addToast('success', 'Job re-queued'); onRefresh(); },
  });

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="flex items-center justify-between mb-6">
          <h2 style={{ fontSize: 18 }}>Job Detail</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* Header */}
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <StatusBadge status={j.status} />
            <div className="flex gap-2">
              {['QUEUED','SCHEDULED'].includes(j.status) && (
                <button className="btn btn-danger btn-sm" onClick={() => cancel.mutate()}>Cancel</button>
              )}
              {['FAILED','DEAD','CANCELLED'].includes(j.status) && (
                <button className="btn btn-success btn-sm" onClick={() => retry.mutate()}>↺ Retry</button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{j.type}</div>
          <div className="font-mono text-muted" style={{ fontSize: 11 }}>{j.id}</div>
          <div className="divider" />
          <div className="grid-2" style={{ fontSize: 12 }}>
            <div><span className="text-muted">Queue: </span><strong>{j.queue?.name}</strong></div>
            <div><span className="text-muted">Priority: </span><strong>{j.priority}</strong></div>
            <div><span className="text-muted">Attempts: </span><strong>{j.retryCount}/{j.maxRetries}</strong></div>
            <div><span className="text-muted">Created: </span><strong>{formatDistanceToNow(new Date(j.createdAt), { addSuffix: true })}</strong></div>
            {j.scheduledAt && <div><span className="text-muted">Scheduled: </span><strong>{format(new Date(j.scheduledAt), 'MMM d, HH:mm')}</strong></div>}
            {j.cronExpression && <div><span className="text-muted">Cron: </span><code className="font-mono">{j.cronExpression}</code></div>}
          </div>
        </div>

        {/* Payload */}
        <div className="card mb-4">
          <h4 style={{ marginBottom: 12 }}>Payload</h4>
          <div className="log-viewer" style={{ maxHeight: 150 }}>
            <pre style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{JSON.stringify(j.payload, null, 2)}</pre>
          </div>
        </div>

        {/* Executions */}
        {j.executions?.length > 0 && (
          <div className="card mb-4">
            <h4 style={{ marginBottom: 12 }}>Execution History</h4>
            {j.executions.map((e: any) => (
              <div key={e.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between">
                  <span>Attempt #{e.attemptNumber}</span>
                  <span className={`badge badge-${e.status.toLowerCase()}`}>{e.status}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {e.worker?.hostname} · {e.durationMs ? `${(e.durationMs/1000).toFixed(2)}s` : 'running...'}
                </div>
                {e.errorMessage && (
                  <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--error-soft)', borderRadius: 6, fontSize: 12, color: 'var(--error)' }}>
                    {e.errorMessage}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Logs */}
        {j.logs?.length > 0 && (
          <div className="card">
            <h4 style={{ marginBottom: 12 }}>Logs</h4>
            <div className="log-viewer">
              {j.logs.map((l: any) => (
                <div key={l.id} className="log-line">
                  <span className="log-time">{format(new Date(l.timestamp), 'HH:mm:ss.SSS')}</span>
                  <span className={`log-level-${l.level.toLowerCase()}`}>{l.level}</span>
                  <span className="log-message">{l.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function CreateJobModal({ onClose, projectId }: { onClose: () => void; projectId: string }) {
  const qc = useQueryClient();
  const { data: qData } = useQuery({
    queryKey: ['queues', projectId],
    queryFn: () => api.get(`/queues?projectId=${projectId}`).then(r => r.data),
  });
  const queues = qData?.queues || [];

  const [form, setForm] = useState({
    queueId: queues[0]?.id || '',
    type: 'echo',
    payload: '{\n  "message": "Hello, World!"\n}',
    priority: 0,
    jobMode: 'immediate',
    delayMs: 5000,
    scheduledAt: '',
    cronExpression: '',
    maxRetries: 3,
    timeout: 30000,
    idempotencyKey: '',
  });

  const create = useMutation({
    mutationFn: () => {
      const body: any = {
        queueId: form.queueId,
        type: form.type,
        payload: JSON.parse(form.payload),
        priority: form.priority,
        maxRetries: form.maxRetries,
        timeout: form.timeout,
      };
      if (form.idempotencyKey) body.idempotencyKey = form.idempotencyKey;
      if (form.jobMode === 'delayed') body.delayMs = form.delayMs;
      if (form.jobMode === 'scheduled') body.scheduledAt = form.scheduledAt;
      if (form.jobMode === 'cron') body.cronExpression = form.cronExpression;
      return api.post('/jobs', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      addToast('success', 'Job created successfully');
      onClose();
    },
    onError: (e: any) => addToast('error', e.response?.data?.message || 'Failed to create job'),
  });

  let payloadError = '';
  try { JSON.parse(form.payload); } catch { payloadError = 'Invalid JSON payload'; }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Create Job</h3>
          <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Queue *</label>
              <select className="form-select" value={form.queueId} onChange={e => setForm({...form, queueId: e.target.value})}>
                {queues.map((q: any) => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Job Type *</label>
              <input className="form-input" value={form.type} onChange={e => setForm({...form, type: e.target.value})} placeholder="echo, send-email, ..." />
            </div>
          </div>

          {/* Job mode */}
          <div className="form-group">
            <label className="form-label">Scheduling Mode</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['immediate','▶ Immediate'],['delayed','⏱ Delayed'],['scheduled','📅 Scheduled'],['cron','🔄 Recurring']].map(([v,l]) => (
                <button key={v} className={`btn btn-sm ${form.jobMode === v ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setForm({...form, jobMode: v})}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {form.jobMode === 'delayed' && (
            <div className="form-group">
              <label className="form-label">Delay (ms)</label>
              <input className="form-input" type="number" value={form.delayMs} onChange={e => setForm({...form, delayMs: parseInt(e.target.value)})} />
            </div>
          )}
          {form.jobMode === 'scheduled' && (
            <div className="form-group">
              <label className="form-label">Scheduled At (UTC)</label>
              <input className="form-input" type="datetime-local" value={form.scheduledAt} onChange={e => setForm({...form, scheduledAt: e.target.value + ':00Z'})} />
            </div>
          )}
          {form.jobMode === 'cron' && (
            <div className="form-group">
              <label className="form-label">Cron Expression</label>
              <input className="form-input font-mono" value={form.cronExpression} onChange={e => setForm({...form, cronExpression: e.target.value})} placeholder="*/5 * * * *" />
              <span className="form-hint">Examples: every minute: * * * * * | every hour: 0 * * * *</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Payload (JSON) *</label>
            <textarea className="form-textarea" value={form.payload} onChange={e => setForm({...form, payload: e.target.value})} rows={5} />
            {payloadError && <span style={{ color: 'var(--error)', fontSize: 12 }}>{payloadError}</span>}
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Priority</label>
              <input className="form-input" type="number" min={-100} max={100} value={form.priority} onChange={e => setForm({...form, priority: parseInt(e.target.value)})} />
            </div>
            <div className="form-group">
              <label className="form-label">Max Retries</label>
              <input className="form-input" type="number" min={0} max={100} value={form.maxRetries} onChange={e => setForm({...form, maxRetries: parseInt(e.target.value)})} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Idempotency Key (optional)</label>
            <input className="form-input" value={form.idempotencyKey} onChange={e => setForm({...form, idempotencyKey: e.target.value})} placeholder="unique-key-to-prevent-duplicates" />
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending || !!payloadError || !form.queueId}>
              {create.isPending ? '⏳ Creating...' : 'Create Job'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function JobsPage({ projectId }: JobsProps) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ status: '', queueId: '', page: 1 });
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: qData } = useQuery({
    queryKey: ['queues', projectId],
    queryFn: () => api.get(`/queues?projectId=${projectId}`).then(r => r.data),
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['jobs', projectId, filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.queueId) params.set('queueId', filters.queueId);
      params.set('page', filters.page.toString());
      params.set('limit', '20');
      // Get all queues from this project (simplified: filter client-side if needed)
      if (!filters.queueId && qData?.queues) {
        // we'd need queueId in filter
      }
      return api.get(`/jobs?${params}`).then(r => r.data);
    },
    refetchInterval: 8000,
    enabled: !!projectId,
  });

  const jobs = data?.jobs || [];
  const pagination = data?.pagination;
  const queues = qData?.queues || [];

  return (
    <div className="animate-fade">
      <div className="page-header">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle">{pagination?.total ?? 0} total jobs</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create Job</button>
      </div>

      {/* Filters */}
      <div className="filter-row">
        <select className="form-select" style={{ width: 160 }} value={filters.status} onChange={e => setFilters({...filters, status: e.target.value, page: 1})}>
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.filter(Boolean).map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="form-select" style={{ width: 200 }} value={filters.queueId} onChange={e => setFilters({...filters, queueId: e.target.value, page: 1})}>
          <option value="">All Queues</option>
          {queues.map((q: any) => <option key={q.id} value={q.id}>{q.name}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={() => setFilters({ status: '', queueId: '', page: 1 })}>Clear</button>
      </div>

      {/* Table */}
      <div className="card">
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...Array(5)].map((_,i) => <div key={i} className="skeleton" style={{ height: 40 }} />)}
          </div>
        ) : jobs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">⚡</div>
            <h3>No jobs found</h3>
            <p>Create a job or adjust your filters</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Queue</th>
                  <th>Priority</th>
                  <th>Attempts</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j: any) => (
                  <tr key={j.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedJob(j)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{j.type}</div>
                      <div className="font-mono text-muted" style={{ fontSize: 10 }}>{j.id.slice(0,8)}...</div>
                    </td>
                    <td><StatusBadge status={j.status} /></td>
                    <td><span className="font-mono" style={{ fontSize: 12 }}>{j.queue?.name}</span></td>
                    <td><span style={{ color: j.priority > 0 ? 'var(--success)' : j.priority < 0 ? 'var(--error)' : 'var(--text-muted)' }}>{j.priority}</span></td>
                    <td>{j.retryCount}/{j.maxRetries}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatDistanceToNow(new Date(j.createdAt), { addSuffix: true })}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {['FAILED','DEAD'].includes(j.status) && (
                          <button className="btn btn-success btn-xs" onClick={() => api.post(`/jobs/${j.id}/retry`).then(() => { qc.invalidateQueries({ queryKey: ['jobs'] }); addToast('success', 'Retried'); })}>
                            ↺
                          </button>
                        )}
                        {['QUEUED','SCHEDULED'].includes(j.status) && (
                          <button className="btn btn-danger btn-xs" onClick={() => api.post(`/jobs/${j.id}/cancel`).then(() => { qc.invalidateQueries({ queryKey: ['jobs'] }); addToast('success', 'Cancelled'); })}>
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="pagination">
            <button className="page-btn" disabled={filters.page <= 1} onClick={() => setFilters({...filters, page: filters.page - 1})}>‹</button>
            {[...Array(Math.min(pagination.pages, 7))].map((_,i) => {
              const p = i + 1;
              return <button key={p} className={`page-btn ${filters.page === p ? 'active' : ''}`} onClick={() => setFilters({...filters, page: p})}>{p}</button>;
            })}
            <button className="page-btn" disabled={filters.page >= pagination.pages} onClick={() => setFilters({...filters, page: filters.page + 1})}>›</button>
          </div>
        )}
      </div>

      {selectedJob && <JobDrawer job={selectedJob} onClose={() => setSelectedJob(null)} onRefresh={refetch} />}
      {showCreate && <CreateJobModal onClose={() => setShowCreate(false)} projectId={projectId} />}
    </div>
  );
}
