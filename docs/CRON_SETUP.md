# Life Coach Cron Jobs Setup

## Morning Intervention (Daily 9 AM)

Add to OpenClaw cron:

```bash
openclaw cron add \
  --name "life-coach-morning" \
  --schedule "0 9 * * *" \
  --command "http://localhost:8787/jobs/run-morning-cycle" \
  --method POST
```

Or edit OpenClaw config:

```json
{
  "cron": {
    "jobs": [
      {
        "name": "life-coach-morning",
        "schedule": "0 9 * * *",
        "enabled": true,
        "action": {
          "type": "webhook",
          "url": "http://localhost:8787/jobs/run-morning-cycle",
          "method": "POST",
          "headers": {
            "Content-Type": "application/json"
          }
        }
      }
    ]
  }
}
```

## KBI Monitor (Every 4 Hours)

```bash
openclaw cron add \
  --name "life-coach-monitor" \
  --schedule "0 */4 * * *" \
  --command "http://localhost:8787/jobs/run-monitor-cycle" \
  --method POST
```

## Weekly Review (Sundays 6 PM)

```bash
openclaw cron add \
  --name "life-coach-weekly" \
  --schedule "0 18 * * 0" \
  --command "http://localhost:8787/jobs/run-morning-cycle?type=weekly" \
  --method POST
```

## Via OpenClaw Native Cron

```javascript
// In OpenClaw config
cron: {
  jobs: [
    {
      id: 'life-coach-morning',
      name: 'Life Coach Morning Intervention',
      schedule: '0 9 * * *', // 9 AM daily
      timezone: 'America/Los_Angeles',
      enabled: true,
      action: {
        type: 'http',
        url: 'http://localhost:8787/jobs/run-morning-cycle',
        method: 'POST'
      },
      onSuccess: {
        notify: 'admin',
        log: true
      },
      onFailure: {
        retry: 3,
        alert: true
      }
    },
    {
      id: 'life-coach-monitor',
      name: 'Life Coach KBI Monitor',
      schedule: '0 */4 * * *', // Every 4 hours
      enabled: true,
      action: {
        type: 'http',
        url: 'http://localhost:8787/jobs/run-monitor-cycle',
        method: 'POST'
      }
    }
  ]
}
```

## Delivery Configuration

Life Coach can deliver interventions via:

### Option A: OpenClaw System Events
```bash
# Life Coach emits to OpenClaw
curl -X POST http://localhost:8787/jobs/run-morning-cycle \
  -H "Content-Type: application/json" \
  -d '{"delivery": {"mode": "redis", "queue": "openclaw:events"}}'
```

### Option B: Direct Telegram
```bash
# Life Coach sends directly to Telegram
CRON_DELIVERY_MODE=webhook
CRON_EVENT_WEBHOOK_URL=https://api.telegram.org/bot<TOKEN>/sendMessage
```

### Option C: In-App Notifications
```bash
# Store in database, app polls
CRON_DELIVERY_MODE=none
# App checks /intervention/morning/:userId
```

## Monitoring Cron Jobs

```bash
# View all Life Coach cron jobs
openclaw cron list | grep life-coach

# View execution history
openclaw cron history --job=life-coach-morning

# Check next run
openclaw cron next --job=life-coach-morning
```
