# JobFlow — API Reference

Base URL: `http://localhost:3001/api`

All authenticated endpoints require `Authorization: Bearer <token>` header.

---

## Authentication

### POST /auth/register
Create a new user account and organization.

**Request**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "securepassword",
  "orgName": "Acme Corp"
}
```

**Response 201**
```json
{
  "token": "eyJhbGci...",
  "user": { "id": "uuid", "email": "jane@example.com", "name": "Jane Doe" },
  "organization": { "id": "uuid", "name": "Acme Corp", "slug": "acme-corp" }
}
```

---

### POST /auth/login
**Request**: `{ "email": "...", "password": "..." }`

**Response 200**
```json
{
  "token": "eyJhbGci...",
  "user": { "id": "...", "email": "...", "name": "..." },
  "organizations": [{ "id": "...", "name": "...", "role": "OWNER" }]
}
```

---

### GET /auth/me
Returns authenticated user profile with organizations and projects.

---

## Projects

### GET /projects
Returns all projects the user has access to.

### POST /projects
```json
{ "orgId": "uuid", "name": "My Project", "slug": "my-project" }
```
Response includes `apiKey` (shown only once).

### GET /projects/:id
Full project detail including queues and workers.

### DELETE /projects/:id
Owner only. Cascades to all queues, jobs, and executions.

### POST /projects/:id/rotate-key
Rotates the API key. Returns new `apiKey`.

---

## Queues

### GET /queues?projectId=&page=&limit=
List queues with live stats (pending/running/completed/failed counts).

### POST /queues
```json
{
  "projectId": "uuid",
  "name": "email-delivery",
  "priority": 10,
  "concurrencyLimit": 20,
  "retryStrategy": "EXPONENTIAL",
  "maxRetries": 5,
  "retryDelayMs": 1000,
  "retryMaxDelayMs": 60000,
  "rateLimitPerMin": 100
}
```

### GET /queues/:id
Queue detail with stats.

### PATCH /queues/:id
Update any queue config field (except name and projectId).

### POST /queues/:id/pause
Sets `paused = true`. Workers stop claiming from this queue immediately.

### POST /queues/:id/resume
Sets `paused = false`.

### DELETE /queues/:id
Cascades to all jobs.

### GET /queues/:id/stats?hours=24
Time-series execution stats bucketed by hour.

---

## Jobs

### POST /jobs — Create Job

**Immediate job**:
```json
{
  "queueId": "uuid",
  "type": "send-email",
  "payload": { "to": "user@example.com", "template": "welcome" },
  "priority": 5,
  "maxRetries": 3,
  "timeout": 30000
}
```

**Delayed job** (add `delayMs`):
```json
{ ..., "delayMs": 60000 }
```

**Scheduled job** (add `scheduledAt`):
```json
{ ..., "scheduledAt": "2024-12-25T09:00:00Z" }
```

**Recurring cron job** (add `cronExpression`):
```json
{ ..., "cronExpression": "0 9 * * MON-FRI" }
```

**With idempotency**:
```json
{ ..., "idempotencyKey": "welcome-email-user-123" }
```

**Response 201**: `{ "job": { "id": "...", "status": "QUEUED", ... } }`

**Error 409**: Idempotency key collision or queue paused.

---

### POST /jobs/batch — Create Batch
```json
{
  "queueId": "uuid",
  "jobs": [
    { "type": "process-record", "payload": { "id": 1 } },
    { "type": "process-record", "payload": { "id": 2 } }
  ]
}
```
Response: `{ "batchId": "batch_...", "count": 2, "jobs": ["uuid1", "uuid2"] }`

---

### GET /jobs
**Query params**: `queueId`, `status` (comma-separated), `type`, `batchId`, `page`, `limit`, `sortBy`, `sortOrder`, `from`, `to`

**Response**:
```json
{
  "jobs": [...],
  "pagination": { "page": 1, "limit": 20, "total": 150, "pages": 8 }
}
```

---

### GET /jobs/:id
Full job detail including executions, logs, DLQ entry, workflow deps.

### POST /jobs/:id/cancel
Cancels QUEUED or SCHEDULED jobs.

### POST /jobs/:id/retry
Re-queues FAILED, DEAD, or CANCELLED jobs.

### GET /jobs/:id/logs?level=&limit=
Execution logs for a job.

---

## Workers

### POST /workers/register
```json
{
  "projectId": "uuid",
  "hostname": "worker-1.prod",
  "pid": 12345,
  "queueIds": ["uuid1", "uuid2"],
  "concurrency": 10
}
```

### POST /workers/:id/heartbeat
```json
{ "jobsRunning": 3, "memoryMb": 256.5, "cpuPct": 45.2, "status": "BUSY" }
```

### GET /workers?projectId=&status=
List workers. Automatically marks workers OFFLINE if heartbeat lapsed >30s.

### GET /workers/:id
Worker detail with recent heartbeats and running executions.

### POST /workers/:id/deregister
Sets worker status to OFFLINE.

---

## Metrics

### GET /metrics?projectId=&hours=24
Full metrics bundle:
```json
{
  "summary": {
    "totalJobs": 1000,
    "completedJobs": 920,
    "failedJobs": 60,
    "successRate": 93.88,
    "avgDurationMs": 1420
  },
  "throughput": [{ "timestamp": "...", "completed": 45, "failed": 3 }],
  "queueBreakdown": [{ "queueId": "...", "queueName": "email", "pending": 5, "running": 2 }]
}
```

### GET /metrics/system?projectId=
System health: worker counts, DLQ count, uptime.

---

## Dead Letter Queue

### GET /dlq?projectId=&queueId=&resolved=false
List DLQ entries.

### POST /dlq/:id/resolve
Mark entry as resolved (no re-execution).

### POST /dlq/:id/requeue
Re-queues the failed job and marks entry resolved.

---

## WebSocket

### WS /ws/events?projectId=

Connect to receive real-time events for a project.

**Events received**:
```json
{ "event": "job:running", "data": { "jobId": "...", "type": "...", "workerId": "..." }, "timestamp": "..." }
{ "event": "job:completed", "data": { "jobId": "...", "durationMs": 1234 }, "timestamp": "..." }
{ "event": "job:dead", "data": { "jobId": "...", "reason": "..." }, "timestamp": "..." }
```

**Keep-alive**: Send `{ "type": "ping" }`, receive `{ "event": "pong" }`.

---

## Error Format

All errors follow this structure:
```json
{
  "statusCode": 400,
  "error": "Validation Error",
  "message": "Request validation failed",
  "details": [{ "field": "email", "message": "Invalid email address" }]
}
```

| Code | Description |
|---|---|
| 400 | Validation error |
| 401 | Missing or invalid JWT/API key |
| 403 | Insufficient permissions (RBAC) |
| 404 | Resource not found |
| 409 | Conflict (duplicate idempotency key, queue paused) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
