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

**Response 200**
```json
{
  "id": "uuid",
  "email": "jane@example.com",
  "name": "Jane Doe",
  "organizations": [
    {
      "id": "uuid",
      "name": "Acme Corp",
      "slug": "acme-corp",
      "role": "OWNER",
      "projects": [{ "id": "uuid", "name": "My Project", "slug": "my-project" }]
    }
  ]
}
```

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

**Response 200**
```json
{
  "queues": [
    {
      "id": "uuid",
      "name": "email-delivery",
      "priority": 10,
      "concurrencyLimit": 20,
      "paused": false,
      "retryStrategy": "EXPONENTIAL",
      "maxRetries": 5,
      "stats": { "pending": 12, "running": 3, "failed": 1, "completed": 450, "total": 466 }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 3 }
}
```

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

**Response 200**
```json
{
  "queue": {
    "id": "uuid",
    "name": "email-delivery",
    "paused": false,
    "retryStrategy": "EXPONENTIAL",
    "maxRetries": 5,
    "retryDelayMs": 1000,
    "retryMaxDelayMs": 60000,
    "retryMultiplier": 2.0,
    "rateLimitPerMin": 100,
    "stats": { "pending": 12, "running": 3, "failed": 1, "completed": 450, "dead": 2 }
  }
}
```

### PATCH /queues/:id
Update any queue config field (except name and projectId).

### POST /queues/:id/pause
Sets `paused = true`. Workers stop claiming from this queue immediately.

**Response 200**: `{ "queue": { ... , "paused": true }, "message": "Queue paused" }`

### POST /queues/:id/resume
Sets `paused = false`.

**Response 200**: `{ "queue": { ... , "paused": false }, "message": "Queue resumed" }`

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

**Response 200**
```json
{
  "job": {
    "id": "uuid",
    "type": "send-email",
    "status": "COMPLETED",
    "payload": { "to": "user@example.com" },
    "retryCount": 1,
    "maxRetries": 3,
    "createdAt": "2024-12-01T10:00:00Z",
    "queue": { "id": "uuid", "name": "email-delivery" },
    "executions": [
      {
        "id": "uuid",
        "attemptNumber": 1,
        "status": "FAILED",
        "errorMessage": "SMTP timeout",
        "durationMs": 5020,
        "worker": { "hostname": "worker-1", "pid": 12345 }
      },
      {
        "id": "uuid",
        "attemptNumber": 2,
        "status": "COMPLETED",
        "durationMs": 1230,
        "worker": { "hostname": "worker-2", "pid": 67890 }
      }
    ],
    "logs": [{ "level": "INFO", "message": "Job created", "timestamp": "..." }],
    "dlqEntry": null
  }
}
```

### POST /jobs/:id/cancel
Cancels QUEUED or SCHEDULED jobs.

**Response 200**: `{ "job": { ..., "status": "CANCELLED" } }`

**Error 409**: `{ "error": "Cannot cancel a job that is already running or completed" }`

### POST /jobs/:id/retry
Re-queues FAILED, DEAD, or CANCELLED jobs. Resets `retryCount` to 0 and removes any DLQ entry.

**Response 200**: `{ "job": { ..., "status": "QUEUED", "retryCount": 0 } }`

**Error 409**: `{ "error": "Only failed, dead, or cancelled jobs can be retried" }`

### GET /jobs/:id/logs?level=&limit=
Execution logs for a job.

**Response 200**
```json
{
  "logs": [
    { "id": "uuid", "level": "INFO", "message": "Job created with status QUEUED", "timestamp": "..." },
    { "id": "uuid", "level": "ERROR", "message": "SMTP connection refused", "timestamp": "..." }
  ]
}
```

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

**Response 200**
```json
{
  "entries": [
    {
      "id": "uuid",
      "jobId": "uuid",
      "reason": "Max retries exceeded",
      "failureCount": 5,
      "lastError": "SMTP connection refused after 30s timeout",
      "originalPayload": { "to": "user@example.com" },
      "failedAt": "2024-12-01T14:30:00Z",
      "resolvedAt": null,
      "job": { "type": "send-email", "queue": { "name": "email-delivery" } }
    }
  ]
}
```

### POST /dlq/:id/resolve
Mark entry as resolved (no re-execution).

**Response 200**: `{ "entry": { ..., "resolvedAt": "2024-12-01T15:00:00Z" } }`

### POST /dlq/:id/requeue
Re-queues the failed job, resets retry count, and marks DLQ entry resolved.

**Response 200**: `{ "entry": { ..., "resolvedAt": "..." }, "job": { ..., "status": "QUEUED", "retryCount": 0 } }`

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
