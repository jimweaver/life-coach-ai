#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const queueKey = `lifecoach:test:delivery-metrics:${Date.now()}:${process.pid}`;

  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;
  process.env.SCHEDULER_DELIVER_MONITOR = 'true';
  process.env.SCHEDULER_DELIVER_MORNING = 'true';

  // avoid policy side effects in this test
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const prepDb = new DatabaseStorageManager();
  const userId = uuidv4();

  try {
    await prepDb.createUserProfile(userId, {
      name: 'delivery-metrics-test-user',
      created_at: new Date().toISOString()
    });

    await prepDb.recordKBIMetric(userId, 'goal_adherence', 0.3);
    await prepDb.recordKBIMetric(userId, 'engagement_score', 1);
    await prepDb.recordKBIMetric(userId, 'mood_trend', 2.4);

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const monitor = await fetch(`${base}/jobs/run-monitor-cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limitUsers: 1 })
      });
      assert(monitor.status === 200, `monitor job should return 200, got ${monitor.status}`);

      const morning = await fetch(`${base}/jobs/run-morning-cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limitUsers: 1 })
      });
      assert(morning.status === 200, `morning job should return 200, got ${morning.status}`);

      const metricsRes = await fetch(`${base}/jobs/delivery/metrics?windowMinutes=120&limit=500`);
      assert(metricsRes.status === 200, `metrics endpoint should return 200, got ${metricsRes.status}`);

      const metrics = await metricsRes.json();
      assert(metrics.ok === true, 'metrics payload should include ok=true');
      assert(metrics.delivery_mode === 'redis', `expected delivery_mode=redis, got ${metrics.delivery_mode}`);
      assert(metrics.queue?.key === queueKey, 'queue key mismatch');
      assert(typeof metrics.queue?.depth === 'number', 'queue depth should be numeric in redis mode');
      assert(metrics.queue.depth >= 1, `expected queue depth >=1, got ${metrics.queue.depth}`);

      assert(metrics.log_metrics?.sample_size >= 1, 'expected non-empty log metrics sample');
      assert(metrics.log_metrics?.attempted_deliveries >= 1, 'expected attempted deliveries >=1');

      assert(metrics.outbox?.total, 'outbox summary missing total');
      assert(metrics.outbox?.recent, 'outbox summary missing recent');

      console.log('✅ delivery metrics endpoint test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await prepDb.redis.del(queueKey).catch(() => {});
    await prepDb.close();
  }
}

run().catch((err) => {
  console.error('❌ delivery metrics endpoint test failed:', err.message);
  process.exit(1);
});
