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

### On-call ownership sync (automation hook)

Optional automation can override warn/critical/escalation owners from a roster file.

- `DELIVERY_ALERT_ONCALL_SYNC_ENABLED` (default: `false`)
- `DELIVERY_ALERT_ONCALL_FILE` (JSON file path)
- `DELIVERY_ALERT_ONCALL_REFRESH_MS` (default: `60000`)
- key mapping controls:
  - `DELIVERY_ALERT_ONCALL_WARN_KEY` (default: `delivery_alert_warn`)
  - `DELIVERY_ALERT_ONCALL_CRITICAL_KEY` (default: `delivery_alert_critical`)
  - `DELIVERY_ALERT_ONCALL_ESCALATION_KEY` (default: `delivery_alert_escalation`)

Roster example:

```json
{
  "owners": {
    "delivery_alert_warn": { "user_id": "<warn-user-id>", "channel": "cron-event" },
    "delivery_alert_critical": { "user_id": "<critical-user-id>", "channel": "cron-event" },
    "delivery_alert_escalation": { "user_id": "<escalation-user-id>", "channel": "cron-event" }
  }
}
```

Inspect effective policy and sync status:
- `GET /jobs/delivery/route-policy?sync=true`

### Ownership drift detection

Use drift detector to catch stale/missing owner assignments:

- Endpoint: `GET /jobs/delivery/ownership-drift?sync=true`
- Drift tuning env:
  - `ALERT_OWNER_DRIFT_WARN_STALE_MINUTES` (default: `120`)
  - `ALERT_OWNER_DRIFT_CRITICAL_STALE_MINUTES` (default: `360`)
  - `ALERT_OWNER_DRIFT_STRICT` (default: `false`)
- Drift routing env:
  - `ALERT_OWNER_DRIFT_ROUTE_ENABLED` (default: `true`)
  - `ALERT_OWNER_DRIFT_ROUTE_MIN_LEVEL` (default: `critical`)
- Drift suppression env (duplicate paging guard):
  - `ALERT_OWNER_DRIFT_SUPPRESSION_ENABLED` (default: `true`)
  - `ALERT_OWNER_DRIFT_COOLDOWN_MINUTES` (default: `30`)
  - `ALERT_OWNER_DRIFT_DUPLICATE_WINDOW_MINUTES` (default: `180`)
  - `ALERT_OWNER_DRIFT_STATE_KEY` (default: `lifecoach:ownership-drift:route-state`)

Drift will raise reasons such as:
- `oncall_sync_stale`
- `oncall_sync_error`
- `missing_warn_owner`
- `missing_critical_owner`

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
   - `GET /jobs/delivery/route-policy?sync=true` (if on-call sync enabled)
   - `GET /jobs/delivery/ownership-drift?sync=true` (drift gate)
2. Trigger policy test suite:
   - `npm run test:alert-policy`
   - `npm run test:alert-ownership`
   - `npm run test:alert-drift`
   - `npm run test:alert-drift-suppress`
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
