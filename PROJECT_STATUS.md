# Life Coach AI — Project Status

Updated: 2026-02-27

## Current completion (OpenClaw-first)

### ✅ Done

1. **Core runtime + storage**
   - Local Redis + PostgreSQL installed and running
   - Schema initialized (users, conversations, messages, goals, kbi, patterns, prefs, logs, milestones)
   - DB manager implemented (`core/storage/database-storage.js`)

2. **14 Agent configs completed**
   - Core resident: orchestrator, context-memory, safety-guardian, career
   - Domain on-demand: health, finance, skill, relationship, decision
   - Shared services: data-collector, progress-tracker, conflict-resolver
   - Supervisory: kbi-monitor, intervention

3. **Orchestration engine implemented**
   - Intent classification (6 domains)
   - Single/multi-domain routing
   - Conflict detection/resolution hook
   - Safety check + emergency short-circuit
   - Persistence to Redis/PostgreSQL

4. **OpenClaw environment alignment**
   - Project docs mirrored into `.docs/life_coach_design`
   - Model routing aligned with requested strategy:
     - Orchestrator → Codex
     - Coding/conflict-critical → Opus
     - General/domain → Kimi

5. **API layer implemented** (`core/api-server.js`)
   - `GET /health`
   - `POST /chat`
   - `GET/POST /profile/:userId`
   - `GET/POST /goals/:userId`
   - `GET /kbi/:userId/:metric`
   - `GET /monitor/:userId`
   - `GET /intervention/morning/:userId`
   - `GET /intervention/weekly/:userId`
   - `POST /intervention/risk`

6. **Test coverage (all pass)**
   - DB connectivity and CRUD
   - Core agent config validation (14/14)
   - Model router validation
   - KBI/intervention logic
   - Day3 multi-domain flow
   - Day4 domain coverage
   - Scheduler runner cycle tests
   - E2E API flow (`chat -> db -> monitor/intervention`)

7. **Scheduled runner (initial) added**
   - `core/scheduler-runner.js`
   - Monitor cycle (`runMonitorCycle`) scans users and evaluates KBI alerts
   - Morning cycle (`runMorningCycle`) generates intervention messages
   - API job endpoints:
     - `POST /jobs/run-monitor-cycle`
     - `POST /jobs/run-morning-cycle`

8. **Production guardrails baseline**
   - Added `core/guardrails.js`
   - Request validation for chat/profile/goals/risk + userId param
   - POST rate limiting (env-controlled)
   - Added guardrail test: `test-api-guardrails.js`

9. **Data collector citation upgrade**
   - Added ranked multi-source citation scoring in `core/data-collector.js`
   - Snapshot now includes: `citations`, `confidence`, `reason`, `total_results`, `generated_at`
   - Added fallback + authority/relevance/domain-fit scoring heuristics
   - Orchestrator response now includes top citations with confidence line
   - Added test: `test-data-collector.js`

10. **Distributed rate-limit backend (Redis) added**
   - Added `createRedisRateLimiter` with memory fallback
   - API now supports `RATE_LIMIT_BACKEND=redis|memory`
   - Shared limiter key prefix via `RATE_LIMIT_KEY_PREFIX`
   - `/health` now exposes `rate_limit_backend`
   - Guardrails integration test now validates Redis-backed path

11. **Model-calling adapter integrated (with reliability hardening)**
   - Added `core/model-adapter.js` (OpenAI-compatible, env-driven)
   - `core/domain-agents.js` now attempts model generation first, with heuristic fallback
   - Supports `DOMAIN_MODEL_ADAPTER_MODE=off|auto|force`
   - Added strict schema validation for model JSON payload
   - Added retry/backoff (`DOMAIN_MODEL_RETRY_MAX`, `DOMAIN_MODEL_RETRY_BASE_DELAY_MS`)
   - Added adapter unit test coverage for skip/success/retry/schema-fail

12. **Audit log normalization baseline added**
   - Added `core/audit-log.js`
   - `logAgentAction` now normalizes/sanitizes agent_id/action/status/duration/session_id
   - Sensitive metadata fields are auto-redacted (`token/api_key/password/authorization/...`)
   - Added audit test coverage: `test-audit-log.js`

13. **Scheduler → OpenClaw cron-event delivery path connected**
   - Added `core/cron-event-delivery.js`
   - Scheduler now emits `systemEvent` envelopes for monitor/morning cycles
   - Delivery backends: `none | redis | webhook` (env-controlled)
   - Redis queue key configurable by `CRON_EVENT_REDIS_LIST_KEY`
   - Added outbound delivery table helpers in DB manager (`outbound_events` auto-ensure)
   - Added tests: `test-cron-delivery.js`, `test-scheduler-delivery.js`
   - `/health` now exposes `cron_delivery_mode`

14. **Guardrails policy tuning + alert hooks added**
   - POST rate-limit now supports per-route buckets (`chat/jobs/intervention/goals/default`)
   - Per-route thresholds configurable by env (`RATE_LIMIT_MAX_CHAT`, `RATE_LIMIT_MAX_JOBS`, ...)
   - Added rate-limit exceed alert hook → `rate-limit-guard` audit logs
   - `/health` now exposes `rate_limit_policy`
   - Added test: `test-rate-limit-policy.js`

15. **Data source quality filters upgraded**
   - `core/data-collector.js` now applies freshness scoring in ranking
   - Added stale-source filtering (`DATA_COLLECTOR_MAX_SOURCE_AGE_DAYS`)
   - Added source dedupe by canonical URL/text fingerprint
   - Snapshot quality block now reports filter metrics (`stale_removed`, `dedupe_removed`, etc.)
   - Extended test coverage in `test-data-collector.js`

16. **Scheduler delivery observability endpoint added**
   - Added `GET /jobs/delivery/metrics` (window + sample limit support)
   - Exposes queue depth (redis mode), delivery log metrics, and outbound status summary
   - Added DB observability helpers: `getSchedulerDeliveryMetrics`, `getOutboundEventStats`
   - Added test: `test-delivery-metrics.js`

---

## In progress / next

1. Add delivery retry/backoff + dead-letter handling for cron-event transport
2. Add data-collector quality telemetry endpoint/reporting (surface quality block via API)
3. Wire outbox table into scheduler delivery flow for durable dispatch tracking
4. Prepare deployment profile (OpenClaw-hosted + local DB)

---

## Runbook

```bash
# API
npm run start:api

# Tests
npm run test:db
npm run test:agents
npm run test:model
npm run test:kbi
npm run test:day3
npm run test:day4
npm run test:scheduler
npm run test:guardrails
npm run test:policy
npm run test:data
npm run test:adapter
npm run test:audit
npm run test:metrics
npm run test:delivery
npm run test:scheduler-delivery
npm run test:e2e
```
