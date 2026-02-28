# HEARTBEAT.md - Life Coach AI Monitoring Routine

_Daily pulse check for the Life Coach AI system and agent health._

## Hourly Checklist

### System Health (Critical)
- [ ] Life Coach API responding (`curl http://localhost:8787/health`)
- [ ] Response time < 2 seconds average
- [ ] No critical alerts (`/metrics/alerts`)
- [ ] Deep health check passes (`/health/deep`)
- [ ] Database connections healthy (PostgreSQL + Redis)
- [ ] Connection pools not exhausted (`/health/pools`)

### User Activity
- [ ] Check for new messages needing response
- [ ] Review recent conversations for follow-ups
- [ ] Monitor user goal progress
- [ ] Scan for crisis keywords in recent messages
- [ ] Check for stuck sessions (>30 min inactive)

### Scheduled Tasks
- [ ] Monitor cycle running (every 4 hours)
- [ ] Morning interventions delivered (9 AM daily)
- [ ] Dead-letter queue processed
- [ ] Retry cycle handling failed events
- [ ] Metrics collected and stored

### Safety & Quality
- [ ] Crisis detection system active
- [ ] No unhandled safety events
- [ ] Response quality within acceptable range
- [ ] User feedback reviewed
- [ ] Error rate < 0.1%

### Integration Health
- [ ] OpenClaw gateway connection stable
- [ ] Telegram bot responding
- [ ] External APIs accessible (OpenAI, Brave)
- [ ] Webhook delivery success rate > 95%

## Response Format

**If all clear:**
```
HEARTBEAT_OK
```

**If issues detected:**
```
⚠️ [System]: [Brief issue description]
Impact: [What's affected]
Action: [Recommended next step]
Urgency: [low/medium/high/critical]
```

## Daily Tasks

### Morning (9:00 AM)
- [ ] Verify morning cycle ran successfully
- [ ] Check overnight user messages
- [ ] Review KBI trends from previous day
- [ ] Verify system metrics from morning cycle
- [ ] Check for any failed deliveries

### Afternoon (1:00 PM)
- [ ] Review user goal progress
- [ ] Check for any stuck conversations
- [ ] Monitor error logs for patterns
- [ ] Review feedback from users
- [ ] Check cache hit rates

### Evening (6:00 PM)
- [ ] Prepare for next day's interventions
- [ ] Review daily metrics summary
- [ ] Check for any safety alerts
- [ ] Verify all systems stable for overnight
- [ ] Run deep health check

## Weekly Tasks

### Monday
- [ ] Review weekly goal progress for all users
- [ ] Analyze weekend activity patterns
- [ ] Check weekly error trends
- [ ] Plan week ahead

### Wednesday
- [ ] Mid-week performance review
- [ ] Check latency trends
- [ ] Review database query performance
- [ ] Verify backup completion

### Friday
- [ ] Weekly metrics summary
- [ ] Review any issues from the week
- [ ] Check disk usage and growth trends
- [ ] Prepare weekly report for TJ

### Sunday
- [ ] Full system health check
- [ ] Review long-term trends
- [ ] Plan upcoming maintenance

## Monthly Tasks

- [ ] User retention analysis
- [ ] Goal completion rates review
- [ ] System performance trends
- [ ] Feature usage statistics
- [ ] Cost analysis (API usage)
- [ ] Security review
- [ ] Dependency updates check

## Critical Alerts (Immediate Action Required)

### CRITICAL - Act Immediately
- [ ] Life Coach API down
- [ ] Crisis keyword detected (safety event)
- [ ] Database connection failure
- [ ] Data loss or corruption
- [ ] Security breach suspected
- [ ] User reports harmful advice

### HIGH - Act Within 1 Hour
- [ ] Error rate > 5%
- [ ] P95 latency > 2000ms
- [ ] Cache hit rate < 50%
- [ ] Multiple failed deliveries
- [ ] External API failures

### MEDIUM - Act Within 4 Hours
- [ ] Error rate > 1%
- [ ] P95 latency > 1000ms
- [ ] Memory usage > 85%
- [ ] Unusual traffic patterns
- [ ] Degraded performance

### LOW - Act Within 24 Hours
- [ ] Minor errors in logs
- [ ] Performance slightly degraded
- [ ] Non-critical feature issues
- [ ] Documentation updates needed

## Key Metrics to Monitor

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Response time (P50) | < 200ms | > 500ms | > 1000ms |
| Response time (P95) | < 500ms | > 1000ms | > 2000ms |
| Response time (P99) | < 1000ms | > 2000ms | > 5000ms |
| Error rate | < 0.1% | > 1% | > 5% |
| Cache hit rate | > 80% | < 70% | < 50% |
| Memory usage | < 70% | > 85% | > 95% |
| DB query avg | < 50ms | > 100ms | > 200ms |
| Pool utilization | < 80% | > 90% | > 95% |

## Quick Health Checks

```bash
# API health
curl http://localhost:8787/health

# Deep health
curl http://localhost:8787/health/deep

# System metrics
curl http://localhost:8787/metrics/dashboard

# Active alerts
curl http://localhost:8787/metrics/alerts

# Database pools
curl http://localhost:8787/health/pools

# Memory usage
curl http://localhost:8787/metrics/memory

# Cache stats
curl http://localhost:8787/metrics/cache
```

## When to Escalate to TJ

**Immediate escalation:**
- System outage lasting > 5 minutes
- Critical safety event (crisis keywords)
- Data loss or corruption
- Security incident

**Same-day escalation:**
- Performance degradation affecting users
- Error rate > 5%
- Failed deployments
- Integration failures

**Daily summary:**
- Routine status updates
- Performance trends
- User feedback summary
- Planned maintenance

## Routine Maintenance Windows

### Daily
- 3:00 AM: Automated backup
- 4:00 AM: KBI monitor cycle
- 9:00 AM: Morning intervention cycle

### Weekly
- Sunday 2:00 AM: Log rotation
- Sunday 3:00 AM: Database maintenance

### Monthly
- First Sunday: Dependency updates
- Mid-month: Security patches

## Emergency Contacts

**System Issues:**
- Check logs: `tail -f logs/api.log`
- Restart: `npm run deploy:up`
- Rollback: `npm run deploy:rollback` (if needed)

**Security Issues:**
- Isolate affected components
- Document incident
- Notify TJ immediately

**Safety Issues:**
- Document all safety events
- Escalate crisis situations
- Review safety protocols

---

_Stay attentive. Stay safe. Help humans grow._
