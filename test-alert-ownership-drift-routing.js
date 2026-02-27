#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const queueKey = `lifecoach:test:ownership-drift-route:${Date.now()}:${process.pid}`;

  const routeWarnUserId = uuidv4();
  const routeCriticalUserId = uuidv4();
  const escalationUserId = uuidv4();

  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;

  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  // force ownership drift with missing/on-fail roster
  process.env.DELIVERY_ALERT_ONCALL_SYNC_ENABLED = 'true';
  process.env.DELIVERY_ALERT_ONCALL_FILE = '/tmp/lifecoach-missing-oncall-roster-for-routing.json';
  process.env.DELIVERY_ALERT_ONCALL_REFRESH_MS = '1000';

  process.env.ALERT_OWNER_DRIFT_WARN_STALE_MINUTES = '1';
  process.env.ALERT_OWNER_DRIFT_CRITICAL_STALE_MINUTES = '2';
  process.env.ALERT_OWNER_DRIFT_STRICT = 'true';

  // enable drift routing
  process.env.ALERT_OWNER_DRIFT_ROUTE_ENABLED = 'true';
  process.env.ALERT_OWNER_DRIFT_ROUTE_MIN_LEVEL = 'critical';

  // configure alert-router recipients
  process.env.ALERT_ROUTING_ENABLED = 'true';
  process.env.ALERT_ROUTING_MIN_LEVEL = 'warn';
  process.env.ALERT_ROUTING_STRATEGY = 'severity';
  process.env.ALERT_ROUTING_CHANNEL = 'cron-event';
  process.env.ALERT_ROUTING_USER_ID_WARN = routeWarnUserId;
  process.env.ALERT_ROUTING_USER_ID_CRITICAL = routeCriticalUserId;
  process.env.ALERT_ROUTING_ESCALATION_ENABLED = 'true';
  process.env.ALERT_ROUTING_ESCALATION_MIN_LEVEL = 'critical';
  process.env.ALERT_ROUTING_ESCALATION_USER_ID = escalationUserId;
  process.env.ALERT_ROUTING_ESCALATION_CHANNEL = 'cron-event';

  const db = new DatabaseStorageManager();

  try {
    // outbox FK targets must exist
    await db.createUserProfile(routeWarnUserId, { name: 'drift-route-warn-user' });
    await db.createUserProfile(routeCriticalUserId, { name: 'drift-route-critical-user' });
    await db.createUserProfile(escalationUserId, { name: 'drift-route-escalation-user' });

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const res = await fetch(`${base}/jobs/delivery/ownership-drift?sync=true&emitAudit=true&route=true`);
      assert(res.status === 200, `ownership drift routing expected 200, got ${res.status}`);

      const payload = await res.json();
      assert(payload.ok === true, 'payload.ok should be true');
      assert(payload.drift?.drift_detected === true, 'expected drift_detected=true');
      assert(payload.drift?.level === 'critical' || payload.drift?.level === 'warn', `unexpected drift level: ${payload.drift?.level}`);
      assert(payload.route?.attempted === true, 'expected route.attempted=true');
      assert(payload.routed?.routed === true, 'expected routed.routed=true');

      // should route to critical + escalation path for critical drift
      assert(payload.routed?.routing?.primaryUserId === routeCriticalUserId,
        `expected primaryUserId=${routeCriticalUserId}, got ${payload.routed?.routing?.primaryUserId}`);
      assert(payload.routed?.routing?.escalation?.userId === escalationUserId,
        `expected escalation userId=${escalationUserId}, got ${payload.routed?.routing?.escalation?.userId}`);
      assert(payload.routed?.delivery?.delivered === true,
        `expected primary delivery delivered=true, got ${payload.routed?.delivery?.delivered}`);
      assert(payload.routed?.escalation?.delivery?.delivered === true,
        `expected escalation delivery delivered=true, got ${payload.routed?.escalation?.delivery?.delivered}`);

      const queueDepth = await db.redis.llen(queueKey);
      assert(queueDepth >= 2, `expected queue depth >=2 for primary+escalation, got ${queueDepth}`);

      const logs = await db.getAgentLogs('delivery-alert', 30);
      const driftLog = logs.find((x) => x.action === 'ownership_drift_detected');
      assert(!!driftLog, 'expected ownership_drift_detected audit log');
      assert(driftLog.metadata?.route?.attempted === true, 'drift audit should record route.attempted=true');

      console.log('✅ alert ownership drift routing test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await db.redis.del(queueKey).catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ alert ownership drift routing test failed:', err.message);
  process.exit(1);
});
