# JobFlow — Entity-Relationship Diagram

## Full ER Diagram

```mermaid
erDiagram
    users {
        uuid id PK
        string email UK
        string password_hash
        string name
        string avatar_url
        timestamp created_at
        timestamp updated_at
    }

    organizations {
        uuid id PK
        string name
        string slug UK
        timestamp created_at
        timestamp updated_at
    }

    org_memberships {
        uuid id PK
        uuid user_id FK
        uuid org_id FK
        enum role "OWNER|ADMIN|MEMBER"
    }

    projects {
        uuid id PK
        uuid org_id FK
        string name
        string slug
        string api_key_hash
        timestamp created_at
        timestamp updated_at
    }

    queues {
        uuid id PK
        uuid project_id FK
        string name
        string description
        int priority
        int concurrency_limit
        bool paused
        enum retry_strategy "FIXED|LINEAR|EXPONENTIAL"
        int max_retries
        int retry_delay_ms
        int retry_max_delay_ms
        float retry_multiplier
        int rate_limit_per_min
        timestamp created_at
        timestamp updated_at
    }

    jobs {
        uuid id PK
        uuid queue_id FK
        string type
        jsonb payload
        enum status "QUEUED|SCHEDULED|CLAIMED|RUNNING|COMPLETED|FAILED|CANCELLED|DEAD"
        int priority
        timestamp scheduled_at
        string cron_expression
        string batch_id
        uuid parent_job_id FK
        string idempotency_key
        int max_retries
        int retry_count
        int timeout
        jsonb metadata
        timestamp created_at
        timestamp updated_at
    }

    job_executions {
        uuid id PK
        uuid job_id FK
        uuid worker_id FK
        int attempt_number
        enum status "RUNNING|COMPLETED|FAILED|TIMED_OUT"
        timestamp started_at
        timestamp completed_at
        int duration_ms
        jsonb result
        string error_message
        string error_stack
    }

    workers {
        uuid id PK
        uuid project_id FK
        string hostname
        int pid
        enum status "IDLE|BUSY|DRAINING|OFFLINE"
        array queue_ids
        int concurrency
        timestamp last_heartbeat_at
        timestamp registered_at
    }

    worker_heartbeats {
        uuid id PK
        uuid worker_id FK
        int jobs_running
        float memory_mb
        float cpu_pct
        timestamp timestamp
    }

    job_logs {
        uuid id PK
        uuid job_id FK
        uuid execution_id FK
        enum level "DEBUG|INFO|WARN|ERROR"
        string message
        jsonb metadata
        timestamp timestamp
    }

    scheduled_jobs {
        uuid id PK
        uuid job_id FK
        string cron_expr
        timestamp next_run_at
        timestamp last_run_at
        bool enabled
        int run_count
        timestamp created_at
    }

    dead_letter_queue {
        uuid id PK
        uuid job_id FK
        uuid queue_id
        string reason
        int failure_count
        jsonb original_payload
        string last_error
        string ai_summary
        timestamp failed_at
        timestamp resolved_at
    }

    workflow_deps {
        uuid id PK
        uuid job_id FK
        uuid depends_on_id FK
    }

    users ||--o{ org_memberships : "has"
    organizations ||--o{ org_memberships : "has"
    organizations ||--o{ projects : "owns"
    projects ||--o{ queues : "has"
    projects ||--o{ workers : "has"
    queues ||--o{ jobs : "contains"
    jobs ||--o{ job_executions : "has"
    jobs ||--o{ job_logs : "has"
    jobs ||--o| scheduled_jobs : "has"
    jobs ||--o| dead_letter_queue : "has"
    jobs ||--o{ workflow_deps : "depends on"
    workers ||--o{ job_executions : "runs"
    workers ||--o{ worker_heartbeats : "sends"
    job_executions ||--o{ job_logs : "has"
```

---

## Table Descriptions

### `users`
Core user accounts. Supports multiple organization memberships.

### `organizations`
Multi-tenant root entity. Multiple users can belong to one org.

### `org_memberships`
Junction table with role-based access control (OWNER > ADMIN > MEMBER).

### `projects`
A project belongs to an org and is the unit of isolation for queues and workers. API keys are hashed with bcrypt.

### `queues`
Configurable job queues with:
- **Concurrency limit**: max simultaneous workers per queue
- **Retry policy**: embedded on the queue (Fixed/Linear/Exponential + delay params)
- **Rate limit**: optional cap on job starts per minute
- **Pause/Resume**: `paused = true` prevents workers from claiming any jobs

### `jobs`
The central table. Key design decisions:
- **Status machine**: QUEUED → SCHEDULED/CLAIMED → RUNNING → COMPLETED/FAILED → DEAD
- **`idempotency_key`**: unique per queue, allows at-most-once semantics for duplicate submissions
- **`scheduled_at`**: used by both delayed jobs and retried jobs
- **JSONB payload**: flexible, indexable with GIN indexes if needed
- **Composite index on `(queue_id, status, scheduled_at)`**: critical for the claim query

### `job_executions`
One row per attempt. Preserves full history of all attempts, including timing and errors.

### `workers`
Self-registered worker instances. Marked OFFLINE automatically when heartbeat lapses >30s.

### `worker_heartbeats`
Time-series table of worker telemetry. Use for CPU/memory trending.

### `job_logs`
Append-only log entries per job/execution. Can be partitioned by month at scale.

### `scheduled_jobs`
Template for recurring cron jobs. Points to a "template" job; the scheduler clones it each run.

### `dead_letter_queue`
Permanent failure record. Includes `ai_summary` field for optional AI-generated failure analysis.

### `workflow_deps`
Stores DAG edges for workflow dependencies (job B cannot start until job A completes).

---

## Index Strategy

| Table | Index | Purpose |
|---|---|---|
| jobs | `(queue_id, status, scheduled_at)` | Efficient job claiming query |
| jobs | `(status, scheduled_at)` | Scheduled job promotion |
| jobs | `(batch_id)` | Batch job lookups |
| job_executions | `(job_id)` | Fetch executions for a job |
| job_executions | `(worker_id)` | Running jobs per worker |
| job_logs | `(job_id, timestamp)` | Log streaming |
| worker_heartbeats | `(worker_id, timestamp)` | Latest heartbeat query |
| scheduled_jobs | `(enabled, next_run_at)` | Due cron scanner |
| dead_letter_queue | `(queue_id, failed_at)` | DLQ listing |
