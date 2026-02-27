#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DeployEventSink = require('./scripts/deploy-event-sink');
const createServer = require('./core/api-server');
const DatabaseStorageManager = require('./core/storage/database-storage');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  process.env.CRON_DELIVERY_MODE = 'none';

  process.env.DEPLOY_TREND_ROUTE_ENABLED = 'true';
  process.env.DEPLOY_TREND_ROUTE_MIN_LEVEL = 'warn';
  process.env.DEPLOY_TREND_ROUTE_USER_ID = uuidv4();
  process.env.DEPLOY_TREND_ROUTE_CHANNEL = 'cron-event';
  process.env.DEPLOY_TREND_ROUTE_RETRY_MAX = '0';

  process.env.DEPLOY_TREND_SUPPRESSION_ENABLED = 'true';
  process.env.DEPLOY_TREND_SUPPRESSION_COOLDOWN_MINUTES = '10';
  process.env.DEPLOY_TREND_SUPPRESSION_DUPLICATE_WINDOW_MINUTES = '10';
  process.env.DEPLOY_TREND_SUPPRESSION_STATE_KEY = `lifecoach:test:deploy-trend-suppress:${Date.now()}:${process.pid}`;

  process.env.DEPLOY_TREND_ANOMALY_WARN_ERROR_RATE = '0.1';
  process.env.DEPLOY_TREND_ANOMALY_CRITICAL_ERROR_RATE = '0.2';

  const runId = uuidv4();
  const sink = new DeployEventSink({ runId, source: 'test-deploy-trend-suppression' });
  const db = new DatabaseStorageManager();

  try {
    const marker = { test_suite: 'deploy_trend_suppression' };
    const now = Date.now();

    for (let i = 0; i < 8; i += 1) {
      await sink.write({
        event: i % 2 === 0 ? 'wrapper.abort' : 'wrapper.step',
        level: i < 6 ? 'error' : 'warn',
        ts: new Date(now - (i * 60_000)).toISOString(),
        ...marker
      });
    }

    await sink.write({ event: 'wrapper.complete', level: 'info', ts: new Date(now - (9 * 60_000)).toISOString(), ...marker });

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      // warm suppression endpoint
      const s1 = await fetch(`${base}/jobs/deploy-events/anomalies/suppression?sinceMinutes=360`);
      assert(s1.status === 200, `suppression endpoint expected 200, got ${s1.status}`);
      const body1 = await s1.json();
      assert(body1.ok === true, 'suppression payload ok should be true');
      assert(body1.suppression?.enabled === true, 'suppression should be enabled');

      // first anomaly route attempt (should not be suppressed)
      const first = await fetch(`${base}/jobs/deploy-events/anomalies?sinceMinutes=360&route=true&emitAudit=true`);
      assert(first.status === 200, `first anomaly route expected 200, got ${first.status}`);
      const firstBody = await first.json();
      assert(firstBody.ok === true, 'first anomaly payload ok should be true');
      assert(firstBody.route?.should_route === true, 'first call should decide to route');
      assert(firstBody.route?.suppressed === false, 'first call should not be suppressed');

      // second anomaly route attempt should be suppressed due cooldown/duplicate window
      const second = await fetch(`${base}/jobs/deploy-events/anomalies?sinceMinutes=360&route=true&emitAudit=true`);
      assert(second.status === 200, `second anomaly route expected 200, got ${second.status}`);
      const secondBody = await second.json();
      assert(secondBody.route?.should_route === true, 'second call should still be routable');
      assert(secondBody.route?.suppressed === true, 'second call should be suppressed');
      assert(secondBody.suppression?.suppressed === true, 'suppression object should indicate suppressed');
      assert(['cooldown', 'duplicate_window'].includes(secondBody.suppression?.reason), `unexpected suppression reason ${secondBody.suppression?.reason}`);

      const logs = await db.getAgentLogs('deploy-trend', 40);
      const hit = logs.find((x) => x.action === 'deploy_trend_anomaly_route_suppressed');
      assert(!!hit, 'expected deploy_trend_anomaly_route_suppressed audit log');

      console.log('✅ deploy trend suppression test passed');
    } finally {
      await shutdown();
    }

    await db.ensureDeployRunEventsTable();
    await db.postgres.query(`DELETE FROM deploy_run_events WHERE payload->>'test_suite' = 'deploy_trend_suppression'`);
  } finally {
    await sink.close().catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ deploy trend suppression test failed:', err.message);
  process.exit(1);
});
