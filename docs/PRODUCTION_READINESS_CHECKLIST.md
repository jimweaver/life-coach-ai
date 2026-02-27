# Production Readiness Checklist

## Scope

This checklist validates production readiness for Life Coach v2 before release.

---

## 1) Health, readiness, shutdown

- [ ] `GET /health` returns `ok: true`
- [ ] `GET /ready` returns `ok: true` while accepting traffic
- [ ] `/health.readiness` includes:
  - `accepting_traffic`
  - `active_requests`
  - `shutdown_grace_ms`
- [ ] Graceful shutdown is idempotent (multiple shutdown signals do not break teardown)
- [ ] Shutdown blocks new write traffic with 503 while draining

Validation commands:

```bash
npm run test:graceful
npm run test:e2e
```

---

## 2) Observability baseline

- [ ] Delivery metrics endpoint: `GET /jobs/delivery/metrics`
- [ ] Delivery alert endpoint: `GET /jobs/delivery/alerts`
- [ ] Dead-letter visibility: `GET /jobs/dead-letter`
- [ ] Replay policy visibility: `GET /jobs/dead-letter/replay-policy`
- [ ] Data quality probe: `GET /data-quality/probe`
- [ ] Deploy events analytics: `GET /jobs/deploy-events` / `GET /jobs/deploy-events/summary`
- [ ] Deploy events dashboard: `GET /jobs/deploy-events/dashboard`
- [ ] Deploy events trend/anomaly: `GET /jobs/deploy-events/trend` / `GET /jobs/deploy-events/anomalies`
- [ ] Deploy anomaly telemetry: `GET /jobs/deploy-events/anomalies/telemetry`
- [ ] Deploy anomaly telemetry trend: `GET /jobs/deploy-events/anomalies/telemetry/trend`
- [ ] Deploy anomaly telemetry threshold alerts: `GET /jobs/deploy-events/anomalies/telemetry/alerts`
- [ ] Deploy anomaly telemetry alert suppression guard (cooldown + duplicate window)
- [ ] Deploy anomaly telemetry alert suppression observability: `GET /jobs/deploy-events/anomalies/telemetry/alerts/suppression`
- [ ] Deploy anomaly telemetry alert suppression trend: `GET /jobs/deploy-events/anomalies/telemetry/alerts/suppression/trend`
- [ ] Deploy anomaly telemetry suppression threshold alerts: `GET /jobs/deploy-events/anomalies/telemetry/alerts/suppression/anomalies`
- [ ] Deploy anomaly telemetry suppression alert routing guard (cooldown + duplicate window)
- [ ] Canary drift check: `GET /jobs/canary/drift`
- [ ] Canary drift trend check: `GET /jobs/canary/drift-trend`
- [ ] Canary drift suppression observability: `GET /jobs/delivery/canary-drift/suppression`

---

## 3) Safety controls

- [ ] Replay safety policy enabled for broad/large batch replay
- [ ] Approver policy configured (`allowlist` and/or `roles`)
- [ ] Alert routing policy configured (route strategy + escalation)

Suggested envs:

- `DEADLETTER_REPLAY_REQUIRE_APPROVAL=true`
- `DEADLETTER_REPLAY_APPROVER_STRATEGY=either|allowlist|role|both`
- `DEADLETTER_REPLAY_APPROVER_ALLOWLIST=<comma-separated ids>`
- `DEADLETTER_REPLAY_APPROVER_ROLES=<comma-separated roles>`
- `DELIVERY_ALERT_ROUTE_ENABLED=true`

---

## 4) Deployment checks

- [ ] Preflight passes: `npm run deploy:preflight`
- [ ] Deploy wrapper passes: `npm run deploy:up`
- [ ] Smoke checks pass:
  - `npm run smoke:check`
  - `npm run smoke:deep`
- [ ] Canary gate pass:
  - `npm run deploy:canary`
- [ ] Canary baseline profile reviewed:
  - `npm run canary:profile`

---

## 5) Test gate

Minimum gate:

```bash
npm run test:guardrails
npm run test:retry
npm run test:replay-safety
npm run test:ops-policy
npm run test:alert-policy
npm run test:alert-drift
npm run test:canary-drift
npm run test:canary-drift-suppression-observability
npm run test:deploy-analytics
npm run test:deploy-trend
npm run test:deploy-anomaly
npm run test:deploy-telemetry
npm run test:deploy-telemetry-trend
npm run test:deploy-telemetry-alert
npm run test:deploy-telemetry-alert-suppression
npm run test:deploy-telemetry-alert-suppression-observability
npm run test:deploy-telemetry-alert-suppression-trend
npm run test:deploy-telemetry-suppression-alert
npm run test:deploy-telemetry-suppression-alert-suppression
npm run test:deploy-dashboard
npm run test:graceful
npm run test:e2e
```
