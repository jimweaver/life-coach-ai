#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const userId = uuidv4();
  const stateKey = `lifecoach:test:delivery-alert:state:${Date.now()}:${process.pid}`;
  const queueKey = `lifecoach:test:delivery-alert:queue:${Date.now()}:${process.pid}`;

  // keep test deterministic
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  process.env.DELIVERY_ALERT_WARN_DEAD_LETTER = '1';
  process.env.DELIVERY_ALERT_CRITICAL_DEAD_LETTER = '2';
  process.env.DELIVERY_ALERT_WARN_FAILURE_RATE = '0.1';
  process.env.DELIVERY_ALERT_CRITICAL_FAILURE_RATE = '0.5';
  process.env.DELIVERY_ALERT_MIN_ATTEMPTS = '1';
  process.env.DELIVERY_ALERT_COOLDOWN_MINUTES = '0';
  process.env.DELIVERY_ALERT_STATE_KEY = stateKey;
  process.env.DELIVERY_ALERT_ROUTE_ENABLED = 'true';
  process.env.DELIVERY_ALERT_ROUTE_RETRY_MAX = '0';
  process.env.DELIVERY_ALERT_ROUTE_USER_ID = userId;

  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;

  const prepDb = new DatabaseStorageManager();

  try {
    await prepDb.createUserProfile(userId, {
      name: 'delivery-alert-test-user',
      created_at: new Date().toISOString()
    });

    // seed dead-letter events so alerting threshold is hit
    const e1 = await prepDb.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId,
      source: 'test-alert',
      payload: { kind: 'systemEvent', text: 'x' }
    });
    await prepDb.markOutboundEventDeadLetter(e1, 'test-failure-1', { from: 'test' });

    const e2 = await prepDb.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.morning',
      userId,
      source: 'test-alert',
      payload: { kind: 'systemEvent', text: 'y' }
    });
    await prepDb.markOutboundEventDeadLetter(e2, 'test-failure-2', { from: 'test' });

    const { shutdown } = await createServer();

    try {
      const base = 'http://localhost:8787';

      const res = await fetch(`${base}/jobs/delivery/alerts?windowMinutes=120&limit=500&emitAudit=true`);
      assert(res.status === 200, `expected 200 from delivery alerts endpoint, got ${res.status}`);

      const payload = await res.json();
      assert(payload.ok === true, 'payload.ok should be true');
      assert(payload.level === 'critical' || payload.level === 'warn', `unexpected alert level: ${payload.level}`);
      assert(Array.isArray(payload.reasons) && payload.reasons.length > 0, 'reasons should be non-empty');
      assert(payload.trend?.dead_letter_total >= 2, 'dead-letter total should be >= 2');
      assert(payload.should_notify === true, 'should_notify should be true in this seeded scenario');

      // new: alert routing payload should be returned and dispatched
      assert(payload.alert_delivery, 'expected alert_delivery object');
      assert(payload.alert_delivery.dispatched === true, 'expected alert_delivery dispatched=true');
      assert(payload.alert_delivery.outbox?.status === 'dispatched', `expected outbox dispatched, got ${payload.alert_delivery.outbox?.status}`);
      assert(payload.routed?.source === 'scheduler', `expected routed.source=scheduler, got ${payload.routed?.source}`);
      assert(payload.routed?.routed === true, 'expected routed.routed=true');

      const queueDepth = await prepDb.redis.llen(queueKey);
      assert(queueDepth >= 1, `expected queue depth >=1, got ${queueDepth}`);

      const dispatchedAlerts = await prepDb.listOutboundEvents({
        status: 'dispatched',
        eventType: 'delivery_alert.triggered',
        limit: 30
      });
      const hit = dispatchedAlerts.find((e) => e.user_id === userId);
      assert(!!hit, 'expected dispatched outbox alert event for test user');

      const logs = await prepDb.getAgentLogs('delivery-alert', 20);
      const hasAlertLog = logs.some((l) => l.action === 'delivery_alert_triggered' && l.metadata?.alert_delivery);
      assert(hasAlertLog, 'expected delivery alert audit log with alert_delivery metadata');

      console.log('✅ delivery alerts endpoint test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await prepDb.redis.del(stateKey).catch(() => {});
    await prepDb.redis.del(queueKey).catch(() => {});
    await prepDb.close();
  }
}

run().catch((err) => {
  console.error('❌ delivery alerts endpoint test failed:', err.message);
  process.exit(1);
});
