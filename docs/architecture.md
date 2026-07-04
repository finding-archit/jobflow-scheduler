# JobFlow — System Architecture

## Overview

JobFlow is a production-grade, multi-tenant distributed job scheduling platform. It is designed around three fundamental principles:

1. **Reliability** — jobs must never be lost or double-executed, even across failures
2. **Scalability** — horizontal scaling of workers without coordination overhead  
3. **Observability** — every job, execution, and worker event is logged and queryable

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     React Dashboard (Vite)                       │
│         Auth │ Queues │ Jobs │ Workers │ Metrics │ DLQ           │
└───────────────────────┬──────────────────────────────────────────┘
                        │ HTTP REST + WebSocket
┌───────────────────────▼──────────────────────────────────────────┐
│                   Fastify API Server (Node.js)                   │
│                                                                  │
│  /api/auth      /api/projects   /api/queues   /api/jobs          │
│  /api/workers   /api/metrics    /api/dlq      /ws/events         │
│                                                                  │
│  JWT Auth │ Rate Limiting │ Error Handling │ Structured Logging  │
└─────┬────────────────────────┬──────────────────┬───────────────┘
      │                        │                  │
 ┌────▼───┐              ┌─────▼─────┐      ┌────▼─────────────┐
 │ Redis  │              │PostgreSQL │      │  WebSocket       │
 │        │              │    16     │      │  (per-project    │
 │Redlock │              │           │      │   rooms)         │
 │Pub/Sub │              │ ACID txns │      └──────────────────┘
 │Rate    │              │ SKIP      │
 │Limit   │              │ LOCKED    │
 └────────┘              └─────┬─────┘
                               │
        ┌──────────────────────┼─────────────────────┐
        │                      │                     │
 ┌──────▼──────┐       ┌───────▼───────┐    ┌───────▼───────┐
 │  Worker 1   │       │   Worker 2    │    │  Scheduler    │
 │             │       │               │    │               │
 │ poll → claim│       │ poll → claim  │    │ Cron scanner  │
 │ execute     │       │ execute       │    │ (every 1 min) │
 │ heartbeat   │       │ heartbeat     │    │ Distributed   │
 │ retry       │       │ retry         │    │ lock via Redis│
 │ DLQ         │       │ DLQ           │    └───────────────┘
 └─────────────┘       └───────────────┘
```

---

## Component Details

### API Server

- **Framework**: Fastify (high-performance, schema-validated)
- **Auth**: JWT (stateless, 7-day expiry) + API keys for programmatic access
- **Rate Limiting**: `@fastify/rate-limit` backed by Redis
- **WebSocket**: Native Fastify WS with Redis pub/sub bridge for multi-instance support
- **Logging**: Pino (structured JSON in production, pretty-printed in dev)

### Worker Service

The worker is the most critical component:

1. **Polling**: Every 1 second, queries PostgreSQL for claimable jobs
2. **Atomic Claiming**: Uses raw SQL `SELECT ... FOR UPDATE SKIP LOCKED` to atomically claim a job without any race conditions
3. **Concurrency**: Fires and forgets job execution (non-blocking) up to `CONCURRENCY` limit
4. **Heartbeat**: Every 10 seconds, updates `last_heartbeat_at` and creates a `WorkerHeartbeat` record
5. **Retry Engine**: On failure, calculates next delay based on queue's retry strategy (Fixed/Linear/Exponential), applies jitter
6. **DLQ**: When `retryCount >= maxRetries`, marks job as `DEAD` and creates a `DeadLetterQueue` entry
7. **Graceful Shutdown**: On SIGTERM, stops accepting new jobs, waits up to 60s for running jobs to complete

### Cron Scheduler

- Runs as a separate process to avoid blocking the worker
- Uses Redis distributed lock (`SET NX PX 55000`) to ensure only one scheduler instance processes crons at a time
- Scans `scheduled_jobs` table every minute for due crons
- Creates a new `Job` row for each triggered cron (template pattern)

### Database (PostgreSQL 16)

Key design choices:
- **`SELECT FOR UPDATE SKIP LOCKED`** — the gold standard for distributed job queues, avoids pessimistic locking contention
- **Cascading deletes** — deleting a project cascades through queues → jobs → executions → logs
- **JSONB payload** — flexible job payloads with index support
- **Composite indexes** — `(queue_id, status, scheduled_at)` for efficient job claiming queries

### Redis

- **Distributed locking** — prevents duplicate cron scheduling across scheduler instances
- **Pub/Sub** — API server publishes job events; WebSocket handler subscribes and broadcasts to connected clients
- **Rate limiting** — token bucket per API endpoint

---

## Data Flow: Job Lifecycle

```
User submits job (POST /api/jobs)
         │
         ▼
    ┌──────────┐
    │  QUEUED  │ ◄── immediate jobs start here
    │ SCHEDULED│ ◄── delayed/cron/future jobs start here
    └─────┬────┘
          │
          │ Worker polls (SELECT FOR UPDATE SKIP LOCKED)
          ▼
    ┌──────────┐
    │  CLAIMED │ ── job locked atomically
    └─────┬────┘
          │ Worker begins execution
          ▼
    ┌──────────┐
    │  RUNNING │ ── heartbeats, logs streaming
    └─────┬────┘
         / \
        /   \
   success   failure
      │          │
      ▼          ▼
 ┌─────────┐  ┌────────┐
 │COMPLETED│  │ FAILED │ ── retry scheduled
 └─────────┘  └────┬───┘
                   │ retries exhausted
                   ▼
              ┌──────┐
              │ DEAD │ ── Dead Letter Queue entry
              └──────┘
```

---

## Scaling Strategy

- **Horizontal worker scaling**: Run N worker processes/containers; each competes for jobs via `SKIP LOCKED`; no coordination needed
- **Queue sharding**: Workers can be assigned to specific queue IDs via `WORKER_QUEUE_IDS` env var
- **Multi-tenant isolation**: Each project has its own queues; workers can be scoped per project
- **API scaling**: Stateless JWT auth enables load-balanced API instances; Redis pub/sub bridges WebSocket events across instances
