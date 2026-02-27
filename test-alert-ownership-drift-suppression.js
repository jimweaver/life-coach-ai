#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const routeUserId = uuidv4();
  const queueKey = `lifecoach:test:owner-drift-suppress:queue:${Date.now()}:${process.pid}`;
  const stateKey = `lifecoach:test:owner-drift-suppress:state:${Date.now()}:${process.pid}`;

  // keep test isolated from unrelated middleware behaviors
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  // route alert path
  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;
  process.env.ALERT_ROUTING_ENABLED = 'true';
  process.env.ALERT_ROUTING_MIN_LEVEL = 'warn';
  process.env.ALERT_ROUTING_USER_ID = routeUserId;
  process.env.ALERT_ROUTING_CHANNEL = 'cron-event';

  // induce ownership drift
  process.env.DELIVERY_ALERT_ONCALL_SYNC_ENABLED = 'true';
  process.env.DELIVERY_ALERT_ONCALL_FILE = '/tmp/lifecoach-owner-drift-missing-roster.json';
  process.env.DELIVERY_ALERT_ONCALL_REFRESH_MS = '1000';

  process.env.ALERT_OWNER_DRIFT_WARN_STALE_MINUTES = '1';
  process.env.ALERT_OWNER_DRIFT_CRITICAL_STALE_MINUTES = '2';
  process.env.ALERT_OWNER_DRIFT_STRICT = 'false';

  // suppression controls under test
  process.env.ALERT_OWNER_DRIFT_ROUTE_ENABLED = 'true';
  process.env.ALERT_OWNER_DRIFT_ROUTE_MIN_LEVEL = 'warn';
  process.env.ALERT_OWNER_DRIFT_SUPPRESSION_ENABLED = 'true';
  process.env.ALERT_OWNER_DRIFT_COOLDOWN_MINUTES = '60';
  process.env.ALERT_OWNER_DRIFT_DUPLICATE_WINDOW_MINUTES = '120';
  process.env.ALERT_OWNER_DRIFT_STATE_KEY = stateKey;

  const db = new DatabaseStorageManager();

  try {
    await db.createUserProfile(routeUserId, { name: `owner-drift-route-${routeUserId.slice(0, 8)}` });

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const first = await fetch(`${base}/jobs/delivery/ownership-drift?sync=true&emitAudit=true&route=true`);
      assert(first.status === 200, `first call expected 200, got ${first.status}`);
      const firstBody = await first.json();

      assert(firstBody.ok === true, 'first call expected ok=true');
      assert(firstBody.route?.candidate === true, 'first call expected route candidate true');
      assert(firstBody.route?.attempted === true, 'first call expected attempted true');
      assert(firstBody.route?.suppression?.suppressed === false, 'first call should not be suppressed');

      const second = await fetch(`${base}/jobs/delivery/ownership-drift?sync=true&emitAudit=true&route=true`);
      assert(second.status === 200, `second call expected 200, got ${second.status}`);
      const secondBody = await second.json();

      assert(secondBody.ok === true, 'second call expected ok=true');
      assert(secondBody.route?.candidate === true, 'second call expected route candidate true');
      assert(secondBody.route?.attempted === false, 'second call should be suppressed (attempted=false)');
      assert(secondBody.route?.suppression?.suppressed === true, 'second call expected suppressed=true');
      assert(
        ['duplicate_within_window', 'cooldown_active'].includes(secondBody.route?.suppression?.reason),
        `unexpected suppression reason: ${secondBody.route?.suppression?.reason}`
      );

      const logs = await db.getAgentLogs('delivery-alert', 50);
      const hasSuppressionAudit = logs.some((l) => l.action === 'ownership_drift_route_suppressed');
      assert(hasSuppressionAudit, 'expected ownership_drift_route_suppressed audit log');

      console.log('✅ alert ownership drift suppression test passed');
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
  console.error('❌ alert ownership drift suppression test failed:', err.message);
  process.exit(1);
});
