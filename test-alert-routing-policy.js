#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const queueKey = `lifecoach:test:alert-routing-policy:${Date.now()}:${process.pid}`;
  const stateKey = `lifecoach:test:alert-routing-policy:state:${Date.now()}:${process.pid}`;

  const seedUserId = uuidv4();
  const routeDefaultUserId = uuidv4();
  const routeWarnUserId = uuidv4();
  const routeCriticalUserId = uuidv4();
  const escalationUserId = uuidv4();

  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;

  // Ensure scheduler-native routing is used
  process.env.DELIVERY_ALERT_ROUTE_ENABLED = 'true';
  process.env.DELIVERY_ALERT_ROUTE_RETRY_MAX = '0';
  process.env.DELIVERY_ALERT_ROUTE_STRATEGY = 'severity';
  process.env.DELIVERY_ALERT_ROUTE_CHANNEL = 'cron-event';
  process.env.DELIVERY_ALERT_ROUTE_USER_ID = routeDefaultUserId;
  process.env.DELIVERY_ALERT_ROUTE_USER_ID_WARN = routeWarnUserId;
  process.env.DELIVERY_ALERT_ROUTE_USER_ID_CRITICAL = routeCriticalUserId;

  process.env.DELIVERY_ALERT_ESCALATION_ENABLED = 'true';
  process.env.DELIVERY_ALERT_ESCALATION_MIN_LEVEL = 'critical';
  process.env.DELIVERY_ALERT_ESCALATION_USER_ID = escalationUserId;
  process.env.DELIVERY_ALERT_ESCALATION_CHANNEL = 'cron-event';

  // Trigger alert deterministically
  process.env.DELIVERY_ALERT_WARN_DEAD_LETTER = '1';
  process.env.DELIVERY_ALERT_CRITICAL_DEAD_LETTER = '2';
  process.env.DELIVERY_ALERT_WARN_FAILURE_RATE = '0.1';
  process.env.DELIVERY_ALERT_CRITICAL_FAILURE_RATE = '0.5';
  process.env.DELIVERY_ALERT_MIN_ATTEMPTS = '1';
  process.env.DELIVERY_ALERT_COOLDOWN_MINUTES = '0';
  process.env.DELIVERY_ALERT_STATE_KEY = stateKey;

  // Keep request limiter from interfering
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const db = new DatabaseStorageManager();

  try {
    // Users referenced by outbox FK must exist
    await db.createUserProfile(seedUserId, { name: 'alert-routing-policy-seed' });
    await db.createUserProfile(routeDefaultUserId, { name: 'route-default' });
    await db.createUserProfile(routeWarnUserId, { name: 'route-warn' });
    await db.createUserProfile(routeCriticalUserId, { name: 'route-critical' });
    await db.createUserProfile(escalationUserId, { name: 'route-escalation' });

    // Seed dead-letter backlog to trigger critical alert
    const dead1 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId: seedUserId,
      source: 'test-alert-routing-policy',
      payload: { kind: 'systemEvent', text: 'seed-1' }
    });
    await db.markOutboundEventDeadLetter(dead1, 'seed-1');

    const dead2 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId: seedUserId,
      source: 'test-alert-routing-policy',
      payload: { kind: 'systemEvent', text: 'seed-2' }
    });
    await db.markOutboundEventDeadLetter(dead2, 'seed-2');

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const policyRes = await fetch(`${base}/jobs/delivery/route-policy`);
      assert(policyRes.status === 200, `route-policy expected 200, got ${policyRes.status}`);
      const policy = await policyRes.json();
      assert(policy.ok === true, 'route-policy should return ok=true');
      assert(policy.policy.route_strategy === 'severity', `expected severity strategy, got ${policy.policy.route_strategy}`);
      assert(policy.policy.escalation_enabled === true, 'expected escalation_enabled=true');
      assert(policy.policy.escalation_user_id === escalationUserId, 'expected configured escalation_user_id');

      const alertsRes = await fetch(`${base}/jobs/delivery/alerts?windowMinutes=120&limit=500&emitAudit=true`);
      assert(alertsRes.status === 200, `alerts endpoint expected 200, got ${alertsRes.status}`);
      const payload = await alertsRes.json();

      assert(payload.ok === true, 'expected ok=true');
      assert(payload.level === 'critical' || payload.level === 'warn', `unexpected alert level: ${payload.level}`);
      assert(payload.should_notify === true, 'expected should_notify=true');
      assert(payload.routed?.source === 'scheduler', `expected routed source scheduler, got ${payload.routed?.source}`);
      assert(payload.alert_delivery?.routing?.strategy === 'severity', 'expected alert routing strategy severity');

      // Critical path should route primary to critical user and trigger escalation
      assert(payload.alert_delivery?.routing?.primary_user_id === routeCriticalUserId,
        `expected primary_user_id=${routeCriticalUserId}, got ${payload.alert_delivery?.routing?.primary_user_id}`);
      assert(payload.alert_delivery?.routing?.escalation_triggered === true, 'expected escalation_triggered=true');
      assert(payload.alert_delivery?.escalation?.outbox?.status === 'dispatched',
        `expected escalation outbox dispatched, got ${payload.alert_delivery?.escalation?.outbox?.status}`);

      const queueDepth = await db.redis.llen(queueKey);
      assert(queueDepth >= 2, `expected queue depth >=2 for primary+escalation, got ${queueDepth}`);

      const dispatchedPrimary = await db.listOutboundEvents({
        status: 'dispatched',
        eventType: 'delivery_alert.triggered',
        limit: 30
      });
      const primaryHit = dispatchedPrimary.find((x) => x.user_id === routeCriticalUserId);
      assert(!!primaryHit, 'expected primary dispatched event for critical route user');

      const dispatchedEsc = await db.listOutboundEvents({
        status: 'dispatched',
        eventType: 'delivery_alert.escalation',
        limit: 30
      });
      const escHit = dispatchedEsc.find((x) => x.user_id === escalationUserId);
      assert(!!escHit, 'expected escalation dispatched event for escalation user');

      console.log('✅ alert routing policy test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await db.redis.del(queueKey).catch(() => {});
    await db.redis.del(stateKey).catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ alert routing policy test failed:', err.message);
  process.exit(1);
});
