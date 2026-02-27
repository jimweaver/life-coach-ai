#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const queueKey = `lifecoach:test:alert-ownership-sync:${Date.now()}:${process.pid}`;
  const stateKey = `lifecoach:test:alert-ownership-sync:state:${Date.now()}:${process.pid}`;

  const seedUserId = uuidv4();
  const fallbackWarnUserId = uuidv4();
  const fallbackCriticalUserId = uuidv4();
  const fallbackEscalationUserId = uuidv4();

  const oncallWarnUserId = uuidv4();
  const oncallCriticalUserId = uuidv4();
  const oncallEscalationUserId = uuidv4();

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lifecoach-oncall-'));
  const rosterPath = path.join(tmpDir, 'oncall.json');

  await fs.writeFile(
    rosterPath,
    JSON.stringify({
      owners: {
        delivery_alert_warn: {
          user_id: oncallWarnUserId,
          channel: 'cron-event'
        },
        delivery_alert_critical: {
          user_id: oncallCriticalUserId,
          channel: 'cron-event'
        },
        delivery_alert_escalation: {
          user_id: oncallEscalationUserId,
          channel: 'cron-event'
        }
      }
    }, null, 2),
    'utf8'
  );

  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;

  process.env.DELIVERY_ALERT_ROUTE_ENABLED = 'true';
  process.env.DELIVERY_ALERT_ROUTE_RETRY_MAX = '0';
  process.env.DELIVERY_ALERT_ROUTE_STRATEGY = 'severity';
  process.env.DELIVERY_ALERT_ROUTE_CHANNEL = 'cron-event';
  process.env.DELIVERY_ALERT_ROUTE_USER_ID_WARN = fallbackWarnUserId;
  process.env.DELIVERY_ALERT_ROUTE_USER_ID_CRITICAL = fallbackCriticalUserId;
  process.env.DELIVERY_ALERT_ESCALATION_ENABLED = 'true';
  process.env.DELIVERY_ALERT_ESCALATION_MIN_LEVEL = 'critical';
  process.env.DELIVERY_ALERT_ESCALATION_USER_ID = fallbackEscalationUserId;
  process.env.DELIVERY_ALERT_ESCALATION_CHANNEL = 'cron-event';

  process.env.DELIVERY_ALERT_ONCALL_SYNC_ENABLED = 'true';
  process.env.DELIVERY_ALERT_ONCALL_FILE = rosterPath;
  process.env.DELIVERY_ALERT_ONCALL_REFRESH_MS = '1000';

  process.env.DELIVERY_ALERT_WARN_DEAD_LETTER = '1';
  process.env.DELIVERY_ALERT_CRITICAL_DEAD_LETTER = '2';
  process.env.DELIVERY_ALERT_WARN_FAILURE_RATE = '0.1';
  process.env.DELIVERY_ALERT_CRITICAL_FAILURE_RATE = '0.5';
  process.env.DELIVERY_ALERT_MIN_ATTEMPTS = '1';
  process.env.DELIVERY_ALERT_COOLDOWN_MINUTES = '0';
  process.env.DELIVERY_ALERT_STATE_KEY = stateKey;

  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const db = new DatabaseStorageManager();

  try {
    const users = [
      seedUserId,
      fallbackWarnUserId,
      fallbackCriticalUserId,
      fallbackEscalationUserId,
      oncallWarnUserId,
      oncallCriticalUserId,
      oncallEscalationUserId
    ];

    for (const userId of users) {
      await db.createUserProfile(userId, { name: `user-${userId.slice(0, 8)}` });
    }

    const dead1 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId: seedUserId,
      source: 'test-alert-ownership-sync',
      payload: { kind: 'systemEvent', text: 'seed-1' }
    });
    await db.markOutboundEventDeadLetter(dead1, 'seed-1');

    const dead2 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId: seedUserId,
      source: 'test-alert-ownership-sync',
      payload: { kind: 'systemEvent', text: 'seed-2' }
    });
    await db.markOutboundEventDeadLetter(dead2, 'seed-2');

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const policyRes = await fetch(`${base}/jobs/delivery/route-policy?sync=true`);
      assert(policyRes.status === 200, `route-policy expected 200, got ${policyRes.status}`);

      const policy = await policyRes.json();
      assert(policy.ok === true, 'route-policy should return ok=true');
      assert(policy.policy.oncall_sync?.enabled === true, 'oncall sync should be enabled');
      assert(policy.policy.oncall_sync?.stale === false, 'oncall sync should not be stale');
      assert(policy.policy.route_user_id_warn === oncallWarnUserId, 'route warn user should be overridden by oncall roster');
      assert(policy.policy.route_user_id_critical === oncallCriticalUserId, 'route critical user should be overridden by oncall roster');
      assert(policy.policy.escalation_user_id === oncallEscalationUserId, 'escalation user should be overridden by oncall roster');

      const alertsRes = await fetch(`${base}/jobs/delivery/alerts?windowMinutes=120&limit=500&emitAudit=true`);
      assert(alertsRes.status === 200, `alerts endpoint expected 200, got ${alertsRes.status}`);
      const payload = await alertsRes.json();

      assert(payload.ok === true, 'expected ok=true');
      assert(payload.should_notify === true, 'expected should_notify=true');
      assert(payload.alert_delivery?.routing?.primary_user_id === oncallCriticalUserId,
        `expected primary_user_id=${oncallCriticalUserId}, got ${payload.alert_delivery?.routing?.primary_user_id}`);
      assert(payload.alert_delivery?.routing?.escalation_user_id === oncallEscalationUserId,
        `expected escalation_user_id=${oncallEscalationUserId}, got ${payload.alert_delivery?.routing?.escalation_user_id}`);

      const dispatchedPrimary = await db.listOutboundEvents({
        status: 'dispatched',
        eventType: 'delivery_alert.triggered',
        limit: 30
      });
      const primaryHit = dispatchedPrimary.find((x) => x.user_id === oncallCriticalUserId);
      assert(!!primaryHit, 'expected primary dispatched event for oncall critical user');

      const dispatchedEsc = await db.listOutboundEvents({
        status: 'dispatched',
        eventType: 'delivery_alert.escalation',
        limit: 30
      });
      const escHit = dispatchedEsc.find((x) => x.user_id === oncallEscalationUserId);
      assert(!!escHit, 'expected escalation dispatched event for oncall escalation user');

      console.log('✅ alert ownership sync test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await db.redis.del(queueKey).catch(() => {});
    await db.redis.del(stateKey).catch(() => {});
    await db.close();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((err) => {
  console.error('❌ alert ownership sync test failed:', err.message);
  process.exit(1);
});
