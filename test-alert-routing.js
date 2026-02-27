#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const queueKey = `lifecoach:test:alert-routing:${Date.now()}:${process.pid}`;
  const stateKey = `lifecoach:test:alert-routing:state:${Date.now()}:${process.pid}`;
  const userId = uuidv4();

  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;
  process.env.ALERT_ROUTING_ENABLED = 'true';
  process.env.ALERT_ROUTING_MIN_LEVEL = 'warn';
  process.env.ALERT_ROUTING_RETRY_MAX = '0';

  // force fallback path to AlertRouter (disable scheduler-native route)
  process.env.DELIVERY_ALERT_ROUTE_ENABLED = 'false';

  process.env.DELIVERY_ALERT_STATE_KEY = stateKey;
  process.env.DELIVERY_ALERT_COOLDOWN_MINUTES = '0';
  process.env.DELIVERY_ALERT_MIN_ATTEMPTS = '1';
  process.env.DELIVERY_ALERT_WARN_DEAD_LETTER = '1';
  process.env.DELIVERY_ALERT_CRITICAL_DEAD_LETTER = '2';

  // avoid limiter side-effects
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const db = new DatabaseStorageManager();

  try {
    await db.createUserProfile(userId, { name: 'alert-routing-user' });

    const dead1 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId,
      source: 'test-alert-routing',
      payload: { kind: 'systemEvent', text: 'seed 1' }
    });
    await db.markOutboundEventDeadLetter(dead1, 'seed-1', { seed: true });

    const dead2 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId,
      source: 'test-alert-routing',
      payload: { kind: 'systemEvent', text: 'seed 2' }
    });
    await db.markOutboundEventDeadLetter(dead2, 'seed-2', { seed: true });

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const res = await fetch(`${base}/jobs/delivery/alerts?windowMinutes=120&limit=500&emitAudit=true`);
      assert(res.status === 200, `expected alerts endpoint 200, got ${res.status}`);
      const body = await res.json();

      assert(body.ok === true, 'expected ok=true');
      assert(body.should_notify === true, 'expected should_notify=true');
      assert(body.routed && body.routed.routed === true, 'expected routed=true');
      assert(body.routed.delivery?.delivered === true, 'expected delivered alert route');

      const queueDepth = await db.redis.llen(queueKey);
      assert(queueDepth >= 1, `expected queue depth >=1, got ${queueDepth}`);

      const queued = await db.redis.lrange(queueKey, 0, -1);
      const parsed = queued.map((x) => JSON.parse(x));
      const hasAlertEvent = parsed.some((e) => e.cycle === 'delivery_alert' || e.metadata?.event_type === 'delivery_alert');
      assert(hasAlertEvent, 'expected delivery_alert envelope in redis queue');

      const logs = await db.getAgentLogs('alert-router', 20);
      const routedLog = logs.find((l) => l.action === 'delivery_alert_routed');
      assert(!!routedLog, 'expected alert-router routed audit log');

      console.log('✅ alert routing integration test passed');
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
  console.error('❌ alert routing integration test failed:', err.message);
  process.exit(1);
});
