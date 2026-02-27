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

17. **Outbox table wired into scheduler dispatch flow**
   - `core/scheduler-runner.js` now enqueues outbound events per monitor/morning intervention
   - Delivery outcome now updates outbox status (`dispatched` / `failed`) with metadata
   - Scheduler cycle summaries now include outbox counters + event ids/status
   - Added integration test: `test-outbox-flow.js`

18. **Delivery retry/backoff + dead-letter handling completed**
   - `CronEventDelivery.deliverWithRetry` with exponential backoff + full jitter
   - `SchedulerRunner.runRetryCycle` picks failed outbox events, re-delivers, dead-letters exhausted
   - DB helpers: `getRetryableEvents`, `incrementRetryCount`, `markOutboundEventDeadLetter`, `getDeadLetterEvents`
   - API endpoints: `POST /jobs/run-retry-cycle`, `GET /jobs/dead-letter`
   - Outbox index: `idx_outbound_events_retry` on `(status, next_retry_at)` for failed events
   - Test: `test-delivery-retry.js` (12 tests)

19. **Data-collector quality telemetry API added**
   - `GET /data-quality/probe?domain=...&input=...` — on-demand quality snapshot (quality block + citations + confidence)
   - `GET /data-quality/domains` — lists supported domains + data-collector config (max_source_age, dedupe, brave status)
   - Validation: domain enum check, input length bounds
   - Test: `test-data-quality-api.js` (8 tests)

20. **Dead-letter replay endpoint added**
   - `POST /jobs/dead-letter/:eventId/replay` for manual replay of dead-letter events
   - Validates `eventId` UUID + optional `maxRetries` (0–20)
   - Replay success path marks event `dispatched`; failed replay remains `dead_letter` with replay metadata
   - Added scheduler method: `replayDeadLetterEvent`
   - Added DB helper: `getOutboundEventById`
   - Test: `test-dead-letter-replay.js`

21. **Inline dispatch retry enabled in scheduler**
   - `dispatchIntervention` now uses `deliverWithRetry` inline (instead of one-shot `deliver`)
   - New config: `SCHEDULER_INLINE_RETRY_MAX` (default `1`)
   - Delivery metadata now carries retry attempts from inline dispatch
   - Added test: `test-inline-dispatch-retry.js`

22. **Deployment profile baseline prepared (OpenClaw-hosted + local DB)**
   - Added deployment profile: `config/deployment/openclaw-local.profile.json`
   - Added env template: `config/deployment/openclaw-local.env.example`
   - Added readiness checker: `scripts/deployment-check.js`
   - Added doc: `docs/DEPLOYMENT_PROFILE.md`
   - Added npm command: `npm run deploy:check`

23. **Dead-letter replay audit/requeue controls (bulk + filters) added**
   - Added API endpoint: `POST /jobs/dead-letter/replay-bulk`
   - Added replay filters: `eventType`, `userId`, `olderThanMinutes`, `limit`, `maxRetries`
   - Added scheduler method: `replayDeadLetterBatch`
   - Extended dead-letter query filters in DB helper (`getDeadLetterEvents`)
   - Added test: `test-dead-letter-bulk-replay.js`

24. **Delivery retry alerting policy added (dead-letter growth escalation)**
   - Added scheduler alert evaluation: `evaluateDeliveryAlert`
   - Added API endpoint: `GET /jobs/delivery/alerts`
   - Policy signals: recent dead-letter count, delivery failure rate, dead-letter growth streak
   - Added cooldown + state tracking in Redis (`DELIVERY_ALERT_STATE_KEY`)
   - Alert events now emit audit logs (`delivery-alert` / `delivery_alert_triggered`)
   - Added test: `test-delivery-alerts.js`

25. **Deployment automation wrapper added (preflight + start)**
   - Added wrapper script: `scripts/deploy-wrapper.js`
   - New commands:
     - `npm run deploy:up` (preflight then start API)
     - `npm run deploy:preflight` (check-only)
   - Supports optional flags: `--skip-check`, `--profile=/abs/path/profile.json`
   - Added verification test: `test-deploy-wrapper.js`

26. **Dead-letter replay safety policy added (approval mode)**
   - `POST /jobs/dead-letter/replay-bulk` now supports `preview` mode for safe dry-run
   - Added safety policy gates: `maxLimit`, `approvalThreshold`, `requireApproval`, optional `approvalCode`
   - Large/broad replay now returns `403 approval_required` unless approved
   - Added blocked-action audit log (`scheduler-replay` / `dead_letter_replay_blocked`)
   - `/health` now exposes dead-letter replay policy snapshot
   - Added test: `test-dead-letter-safety-policy.js`

27. **Alert routing integration hardened (scheduler-native + fallback)**
   - `evaluateDeliveryAlert` now includes native `alert_delivery` result with outbox + retry metadata
   - `GET /jobs/delivery/alerts` now de-dupes routing:
     - prefers scheduler-native routing when present
     - falls back to `AlertRouter` when scheduler-native routing is disabled
   - `/health` now exposes delivery alert route policy snapshot
   - Coverage updated:
     - `test-delivery-alerts.js` validates scheduler-native routing path
     - `test-alert-routing.js` validates AlertRouter fallback path

28. **Deployment docs hardening (rollback + smoke-check playbook)**
   - Added operations doc: `docs/DEPLOYMENT_OPERATIONS.md`
   - Added smoke check scripts:
     - `npm run smoke:check` — quick health + services check
     - `npm run smoke:deep` — extended checks (DB roundtrip, key endpoints)
   - Added rollback procedures for common failure scenarios
   - Added env variables reference for operational tuning

29. **Dead-letter replay ops controls added (allowlist/role-based approval)**
   - Added approver policy controls for bulk replay:
     - `DEADLETTER_REPLAY_APPROVER_ALLOWLIST`
     - `DEADLETTER_REPLAY_APPROVER_ROLES`
     - `DEADLETTER_REPLAY_APPROVER_STRATEGY` (`either|allowlist|role|both`)
   - Added policy introspection endpoint: `GET /jobs/dead-letter/replay-policy`
   - `POST /jobs/dead-letter/replay-bulk` now enforces operator authorization when policy is configured
   - Preview and response payloads now include operator authorization context
   - Added coverage: `test-dead-letter-ops-policy.js`

30. **Alert routing policy controls added (destination strategy + escalation channels)**
   - Scheduler route policy now supports:
     - `DELIVERY_ALERT_ROUTE_STRATEGY` (`single|severity`)
     - `DELIVERY_ALERT_ROUTE_USER_ID_WARN` / `DELIVERY_ALERT_ROUTE_USER_ID_CRITICAL`
     - `DELIVERY_ALERT_ROUTE_CHANNEL`
   - Added escalation controls:
     - `DELIVERY_ALERT_ESCALATION_ENABLED`
     - `DELIVERY_ALERT_ESCALATION_MIN_LEVEL`
     - `DELIVERY_ALERT_ESCALATION_USER_ID`
     - `DELIVERY_ALERT_ESCALATION_CHANNEL`
   - Added policy endpoint: `GET /jobs/delivery/route-policy`
   - Alert delivery result now includes routing metadata + optional escalation dispatch result
   - `/health` now exposes expanded `delivery_alert_policy` snapshot
   - Added coverage: `test-alert-routing-policy.js`

31. **Production readiness checklist + graceful shutdown hardening added**
   - Added readiness endpoint: `GET /ready`
   - `/health` now exposes readiness block (`accepting_traffic`, `active_requests`, `shutdown_grace_ms`)
   - Added request draining + idempotent shutdown guard in `core/api-server.js`
   - Added graceful shutdown test: `test-graceful-shutdown.js`
   - Added checklist doc: `docs/PRODUCTION_READINESS_CHECKLIST.md`
   - Updated deployment ops doc with shutdown gate references

32. **Deployment smoke orchestration mode added (managed lifecycle)**
   - `scripts/deploy-wrapper.js` now supports `--smoke=quick|deep|both`
   - Added commands:
     - `npm run deploy:smoke`
     - `npm run deploy:smoke:deep`
   - Wrapper now performs: start API -> wait `/ready` -> run smoke plan -> graceful stop
   - Added verification test: `test-deploy-smoke-wrapper.js`
   - Deployment docs updated (`DEPLOYMENT_PROFILE.md`, `DEPLOYMENT_OPERATIONS.md`)

33. **Alert destination governance docs added**
   - Added runbook doc: `docs/ALERT_DESTINATION_GOVERNANCE.md`
   - Defines owner matrix for warn/critical delivery alerts
   - Documents escalation handling flow and response expectations
   - Adds policy verification checklist and audit trace expectations
   - Linked from deployment operations production gate

34. **Post-deploy canary flow added (traffic validation + rollback thresholds)**
   - Added canary validator: `scripts/canary-check.js`
   - Added wrapper-managed canary mode: `--canary=traffic`
   - Added command: `npm run deploy:canary`
   - Canary now evaluates rollback recommendation by thresholds:
     - `CANARY_MAX_ERROR_RATE`
     - `CANARY_P95_MAX_MS`
     - `CANARY_AVG_MAX_MS`
   - Added coverage:
     - `test-canary-check.js`
     - `test-deploy-canary-wrapper.js`
   - Updated deployment docs with canary gate

35. **Deploy-wrapper observability hooks added (structured logs + durations)**
   - Added structured event logger in `scripts/deploy-wrapper.js`
   - Supports `DEPLOY_WRAPPER_LOG_FORMAT=text|json`
   - Emits step-level events with duration fields (`duration_ms`, `total_ms`)
   - Covers preflight / readiness / smoke / canary / shutdown lifecycle
   - Added coverage: `test-deploy-observability.js`
   - Updated deployment ops docs with observability env + event reference

36. **Alert ownership automation hooks added (on-call roster sync)**
   - Scheduler routing policy now supports on-call sync overrides from roster file
   - New env controls:
     - `DELIVERY_ALERT_ONCALL_SYNC_ENABLED`
     - `DELIVERY_ALERT_ONCALL_FILE`
     - `DELIVERY_ALERT_ONCALL_REFRESH_MS`
     - `DELIVERY_ALERT_ONCALL_WARN_KEY` / `...CRITICAL_KEY` / `...ESCALATION_KEY`
   - `GET /jobs/delivery/route-policy?sync=true` now exposes effective owner mapping + sync status
   - Alert dispatch now uses effective on-call owners when sync is enabled
   - Added coverage: `test-alert-ownership-sync.js`
   - Updated governance docs with roster format and verification flow

37. **Canary baseline profiling added (auto-calibrated thresholds)**
   - `scripts/canary-check.js` now supports persistent history (`logs/canary-history.jsonl` by default)
   - Added baseline profiling logic from historical canary runs (suggested error/p95/avg thresholds)
   - Added profile command: `npm run canary:profile`
   - Added helper script: `scripts/canary-profile.js`
   - Added test coverage: `test-canary-profile.js`
   - Deployment docs updated with history/profile env controls

38. **Deploy-wrapper event sink integration added (DB persistence)**
   - Added sink module: `scripts/deploy-event-sink.js`
   - Wrapper events now optionally persist to PostgreSQL table `deploy_run_events`
   - Captures run-level structured events with `run_id`, `event`, `level`, timestamps, and payload JSON
   - Event sink mode controlled by `DEPLOY_WRAPPER_EVENT_SINK` (`postgres|none`)
   - Added coverage: `test-deploy-event-sink.js`
   - Wrapper now flushes sink writes before exit to reduce log loss risk

39. **Alert ownership drift detection added (roster freshness + mismatch alerts)**
   - Added drift detector: `core/alert-ownership-drift.js`
   - New API endpoint: `GET /jobs/delivery/ownership-drift?sync=true`
   - Drift signals include stale sync, sync errors, and missing warn/critical ownership
   - `/health` now exposes owner drift tuning snapshot
   - Added coverage: `test-alert-ownership-drift.js`
   - Governance docs updated with drift gate + verification flow

40. **Canary profile drift alarms added (baseline shift notification)**
   - Added drift detector: `core/canary-drift-detector.js`
   - New API endpoint: `GET /jobs/canary/drift`
   - Drift compares active canary thresholds vs history-derived suggested thresholds
   - Supports auto-routing via alert router (`CANARY_DRIFT_ROUTE_ENABLED`, `CANARY_DRIFT_ROUTE_MIN_LEVEL`)
   - Emits audit signal: `canary_profile_drift_detected`
   - Added coverage: `test-canary-drift-alert.js`
   - Deployment/readiness docs updated with canary drift gate

41. **Deploy event analytics endpoint added (`deploy_run_events` query API)**
   - Added DB analytics helpers:
     - `listDeployRunEvents(...)`
     - `summarizeDeployRunEvents(...)`
   - New API endpoints:
     - `GET /jobs/deploy-events`
     - `GET /jobs/deploy-events/summary`
   - Supports filters by `runId`, `event`, `level`, `sinceMinutes`, `limit`
   - Added coverage: `test-deploy-event-analytics.js`
   - Deployment ops docs updated with analytics endpoint usage

42. **Ownership drift alert routing added (critical auto-escalation path)**
   - `GET /jobs/delivery/ownership-drift` now supports routing controls:
     - `ALERT_OWNER_DRIFT_ROUTE_ENABLED`
     - `ALERT_OWNER_DRIFT_ROUTE_MIN_LEVEL`
   - Drift endpoint now returns route metadata (`attempted`, `routed`)
   - Critical ownership drift can auto-route through `AlertRouter` (with escalation path)
   - Added coverage: `test-alert-ownership-drift-routing.js`
   - Governance docs updated with drift routing controls

43. **Canary drift trend endpoint added (windowed drift severity history)**
   - Added trend utility: `scripts/canary-drift-trend.js`
   - New API endpoint: `GET /jobs/canary/drift-trend`
   - Supports window/bucket analysis with filters:
     - `sinceMinutes`, `bucketMinutes`, `minSamples`, `historyFile`
   - Returns bucketed drift distribution (`info/warn/critical`) + drift/critical rates
   - `/health` now exposes trend default settings (`CANARY_DRIFT_TREND_DEFAULT_*`)
   - Added coverage: `test-canary-drift-trend.js`
   - Deployment/readiness docs updated with trend gate

44. **Ownership drift suppression observability endpoint added**
   - Added endpoint: `GET /jobs/delivery/ownership-drift/suppression`
   - Reports suppression state (enabled, suppressed, reason, remaining_ms, redis key state)
   - Documents warn/critical cooldown + duplicate windows
   - Added coverage: `test-alert-ownership-suppression.js`
   - Governance docs updated with suppression verification steps

45. **Deploy event trend dashboard endpoint added (timeline + failure heatmap)**
   - Added DB trend helpers:
     - `summarizeDeployRuns(...)`
     - `getDeployEventTimeline(...)`
     - `getDeployEventHeatmap(...)`
   - New API endpoint: `GET /jobs/deploy-events/trend`
   - Provides:
     - per-run summary (`runs`)
     - bucketed timeline (`timeline`)
     - failure heatmap (`heatmap.rows` + totals)
   - Supports filters: `runId`, `source`, `sinceMinutes`, `bucketMinutes`, limits
   - Added coverage: `test-deploy-event-trend.js`
   - Deployment ops docs updated with trend endpoint usage

46. **Ownership drift suppression controls added (cooldown + duplicate window)**
   - `GET /jobs/delivery/ownership-drift` now supports route suppression guards
   - Added suppression env controls:
     - `ALERT_OWNER_DRIFT_SUPPRESSION_ENABLED`
     - `ALERT_OWNER_DRIFT_COOLDOWN_MINUTES`
     - `ALERT_OWNER_DRIFT_DUPLICATE_WINDOW_MINUTES`
     - `ALERT_OWNER_DRIFT_STATE_KEY`
   - Drift route now suppresses duplicate paging in cooldown/duplicate windows
   - Emits audit signal: `ownership_drift_route_suppressed`
   - `/health` now exposes owner drift suppression config snapshot
   - Added coverage: `test-alert-ownership-drift-suppression.js`
   - Governance docs updated with suppression policy verification

47. **Canary drift auto-suppression controls added (duplicate drift paging guard)**
   - `GET /jobs/canary/drift` now supports route suppression via `suppress=true|false`
   - Added canary suppression env controls:
     - `CANARY_DRIFT_SUPPRESSION_ENABLED`
     - `CANARY_DRIFT_COOLDOWN_MINUTES`
     - `CANARY_DRIFT_DUPLICATE_WINDOW_MINUTES`
     - `CANARY_DRIFT_STATE_KEY`
   - Drift route now suppresses duplicate paging during cooldown/duplicate windows
   - Emits audit signal: `canary_profile_drift_route_suppressed`
   - `/health` now exposes canary drift suppression policy snapshot
   - Added coverage: `test-canary-drift-suppression.js`
   - Deployment ops docs updated with canary suppression policy controls

48. **Deploy trend anomaly detector added (spike + failure regression alerts)**
   - Added detector module: `core/deploy-trend-anomaly.js`
   - New API endpoint: `GET /jobs/deploy-events/anomalies`
   - Detects anomalies across:
     - run error-rate regression
     - abort ratio spikes (`wrapper.abort` vs `wrapper.complete`)
     - run duration regression
     - bucketed event volume spike
   - Supports optional routing via `AlertRouter` (`route`, `routeMinLevel`, `routeUserId`, `routeChannel`)
   - Emits audit signal: `deploy_trend_anomaly_detected`
   - `/health` now exposes `deploy_trend_anomaly_policy` snapshot
   - Added coverage: `test-deploy-trend-anomaly.js`
   - Deployment ops docs updated with anomaly API + env controls

49. **Deploy trend suppression controls added (cooldown + duplicate paging guard)**
   - `GET /jobs/deploy-events/anomalies` now supports route suppression via env controls:
     - `DEPLOY_TREND_SUPPRESSION_ENABLED`
     - `DEPLOY_TREND_COOLDOWN_MINUTES`
     - `DEPLOY_TREND_DUPLICATE_WINDOW_MINUTES`
     - `DEPLOY_TREND_STATE_KEY`
   - Anomaly route now suppresses duplicate paging during cooldown/duplicate windows
   - Emits audit signal: `deploy_trend_anomaly_route_suppressed`
   - `/health` now exposes deploy trend suppression policy snapshot
   - Added suppression observability endpoint: `GET /jobs/deploy-events/anomalies/suppression`
   - Added coverage: `test-deploy-trend-suppression.js`
   - Deployment ops docs updated with suppression controls

50. **AlertRouter generic route() method added**
   - Added `route()` method for flexible alert routing across different alert types
   - Supports `kind`, `level`, `text`, `metadata`, and `options` (toUserId, channel, retryMax)
   - Used by deploy trend anomaly routing + canary drift routing
   - Emits audit log with `{kind}_routed` action type

51. **Deploy event dashboard endpoint added (timeline + heatmap summary)**
   - Added endpoint: `GET /jobs/deploy-events/dashboard`
   - Returns timeline, heatmap, and summary in a single payload for the requested filters
   - Filters: `runId`, `source`, `sinceMinutes`, `bucketMinutes`, `runLimit`, `timelineLimit`, `heatmapLimit`
   - Added coverage: `test-deploy-event-dashboard.js`
   - Deployment ops docs + readiness checklist now reference the dashboard gate
   - Added npm script: `test:deploy-dashboard`

52. **Canary drift suppression observability endpoint hardened + validated**
   - Fixed `GET /jobs/delivery/canary-drift/suppression` to use canary profile drift evaluation (history + active thresholds)
   - Added response fields: `history_file`, `history_count`, `profile`, `drift`, `route`, `suppression`
   - Added validation for `minSamples` query parameter
   - Added dedicated coverage: `test-canary-drift-suppression-observability.js`
   - Added npm script: `test:canary-drift-suppression-observability`
   - Deployment ops docs updated with suppression observability usage + validation commands

---

## In progress / next

1. Continue production readiness hardening (observability + graceful shutdown + managed smoke orchestration)
2. Expand deploy event analytics instrumentation (trend + dashboard) for anomaly visibility and routing telemetry
3. Advance skill-learning hook rollout + auto-learn validation across agents

---

## Runbook

```bash
# API
npm run deploy:preflight
npm run deploy:up

# Managed smoke orchestration (start -> smoke -> stop)
npm run deploy:smoke
npm run deploy:smoke:deep

# Managed canary orchestration (start -> canary -> stop)
npm run deploy:canary
npm run canary:profile

# Smoke checks (post-deploy)
npm run smoke:check
npm run smoke:deep

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
npm run test:outbox
npm run test:delivery
npm run test:scheduler-delivery
npm run test:retry
npm run test:replay
npm run test:replay-bulk
npm run test:replay-safety
npm run test:ops-policy
npm run test:quality
npm run test:alerts
npm run test:alert-routing
npm run test:alert-policy
npm run test:alert-ownership
npm run test:alert-drift
npm run test:alert-drift-route
npm run test:alert-drift-suppress
npm run test:inline-retry
npm run test:deploy
npm run test:deploy-observability
npm run test:deploy-sink
npm run test:deploy-analytics
npm run test:deploy-trend
npm run test:deploy-anomaly
npm run test:deploy-suppression
npm run test:deploy-dashboard
npm run test:deploy-smoke
npm run test:deploy-canary
npm run test:canary
npm run test:canary-profile
npm run test:canary-drift
npm run test:canary-drift-trend
npm run test:canary-drift-suppression
npm run test:canary-drift-suppression-observability
npm run test:graceful
npm run test:e2e
```
