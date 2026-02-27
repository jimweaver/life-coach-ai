# Alert Destination Governance

## Purpose

Define who receives delivery alerts, which channels are used, and escalation ownership for Life Coach v2.

This doc is the operational contract between engineering and on-call operators.

---

## 1) Routing model

Delivery alert routing is controlled by scheduler-native policy.

### Primary routing

- `DELIVERY_ALERT_ROUTE_ENABLED` (default: `true`)
- `DELIVERY_ALERT_ROUTE_STRATEGY`
  - `single`: all alert levels route to `DELIVERY_ALERT_ROUTE_USER_ID`
  - `severity`: warn/critical can route to dedicated owners
- `DELIVERY_ALERT_ROUTE_CHANNEL` (default: `cron-event`)
- `DELIVERY_ALERT_ROUTE_USER_ID`
- `DELIVERY_ALERT_ROUTE_USER_ID_WARN`
- `DELIVERY_ALERT_ROUTE_USER_ID_CRITICAL`

### Escalation routing

- `DELIVERY_ALERT_ESCALATION_ENABLED` (default: `false`)
- `DELIVERY_ALERT_ESCALATION_MIN_LEVEL` (default: `critical`)
- `DELIVERY_ALERT_ESCALATION_USER_ID`
- `DELIVERY_ALERT_ESCALATION_CHANNEL`

---

## 2) Ownership matrix

| Alert level | Primary owner | Escalation owner | Expected response |
|-------------|---------------|------------------|-------------------|
| warn        | Ops primary (warn route user) | none (unless escalation threshold met) | review within 30 min |
| critical    | Ops primary (critical route user) | Incident commander / backup on-call | immediate triage |

Recommended mapping:

- `DELIVERY_ALERT_ROUTE_USER_ID_WARN` → day-shift operator
- `DELIVERY_ALERT_ROUTE_USER_ID_CRITICAL` → on-call operator
- `DELIVERY_ALERT_ESCALATION_USER_ID` → incident commander / backup

---

## 3) Escalation runbook

When critical alert is triggered:

1. **Acknowledge** alert in destination channel.
2. **Inspect metrics**:
   - `GET /jobs/delivery/metrics`
   - `GET /jobs/delivery/alerts`
   - `GET /jobs/dead-letter`
3. **Classify failure type**:
   - transport failure (redis/webhook unavailable)
   - policy/replay blockage
   - persistent dead-letter growth
4. **Apply mitigation**:
   - run retry cycle: `POST /jobs/run-retry-cycle`
   - replay dead-letter (single/bulk with policy):
     - `POST /jobs/dead-letter/:eventId/replay`
     - `POST /jobs/dead-letter/replay-bulk`
5. **Escalate** to incident owner if unresolved after 15 minutes.
6. **Post-incident note**: include root cause + prevention action.

---

## 4) Governance guardrails

- Keep escalation target distinct from primary target when possible.
- Use `severity` strategy for production; avoid single-user bottlenecks.
- Review destination IDs weekly.
- Any change to route/escalation env must be logged in deployment notes.

---

## 5) Verification checklist

After policy changes:

1. Check policy endpoint:
   - `GET /jobs/delivery/route-policy`
2. Trigger policy test suite:
   - `npm run test:alert-policy`
   - `npm run test:alerts`
3. Validate health snapshot includes alert policy:
   - `GET /health` → `delivery_alert_policy`

---

## 6) Audit expectations

For each routed alert, expect audit traces in:

- `agent_logs` with action `delivery_alert_triggered`
- `agent_logs` with action `delivery_alert_routed` (fallback path)
- `outbound_events` rows:
  - `delivery_alert.triggered`
  - `delivery_alert.escalation` (if triggered)

If missing, treat as observability gap and escalate to platform owner.
