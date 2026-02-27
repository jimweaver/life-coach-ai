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

---

## 5) Test gate

Minimum gate:

```bash
npm run test:guardrails
npm run test:retry
npm run test:replay-safety
npm run test:ops-policy
npm run test:alert-policy
npm run test:graceful
npm run test:e2e
```
