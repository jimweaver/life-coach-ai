#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DeployEventSink = require('./scripts/deploy-event-sink');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

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
  process.env.DEPLOY_TREND_SUPPRESSION_STATE_KEY = `lifecoach:test:deploy-trend-telemetry-alert-suppress-trend:anomaly:${Date.now()}:${process.pid}`;

  process.env.DEPLOY_TREND_ANOMALY_WARN_ERROR_RATE = '0.1';
  process.env.DEPLOY_TREND_ANOMALY_CRITICAL_ERROR_RATE = '0.2';

  process.env.DEPLOY_TREND_TELEMETRY_ALERT_ROUTE_ENABLED = 'true';
  process.env.DEPLOY_TREND_TELEMETRY_ALERT_ROUTE_MIN_LEVEL = 'warn';
  process.env.DEPLOY_TREND_TELEMETRY_ALERT_ROUTE_USER_ID = uuidv4();
  process.env.DEPLOY_TREND_TELEMETRY_ALERT_ROUTE_CHANNEL = 'cron-event';
  process.env.DEPLOY_TREND_TELEMETRY_ALERT_ROUTE_RETRY_MAX = '0';

  process.env.DEPLOY_TREND_TELEMETRY_ALERT_SUPPRESSION_ENABLED = 'true';
  process.env.DEPLOY_TREND_TELEMETRY_ALERT_COOLDOWN_MINUTES = '10';
  process.env.DEPLOY_TREND_TELEMETRY_ALERT_DUPLICATE_WINDOW_MINUTES = '10';
  process.env.DEPLOY_TREND_TELEMETRY_ALERT_STATE_KEY = `lifecoach:test:deploy-trend-telemetry-alert-suppress-trend:alert:${Date.now()}:${process.pid}`;

  process.env.DEPLOY_TREND_TELEMETRY_WARN_ROUTE_FAILURE_RATE = '0.2';
  process.env.DEPLOY_TREND_TELEMETRY_CRITICAL_ROUTE_FAILURE_RATE = '0.6';
  process.env.DEPLOY_TREND_TELEMETRY_WARN_SUPPRESSION_RATE = '0.2';
  process.env.DEPLOY_TREND_TELEMETRY_CRITICAL_SUPPRESSION_RATE = '0.6';
  process.env.DEPLOY_TREND_TELEMETRY_WARN_ROUTE_FAILURE_SPIKE = '1.2';
  process.env.DEPLOY_TREND_TELEMETRY_CRITICAL_ROUTE_FAILURE_SPIKE = '1.8';
  process.env.DEPLOY_TREND_TELEMETRY_WARN_SUPPRESSION_SPIKE = '1.2';
  process.env.DEPLOY_TREND_TELEMETRY_CRITICAL_SUPPRESSION_SPIKE = '1.8';
  process.env.DEPLOY_TREND_TELEMETRY_MIN_DETECTIONS = '1';
  process.env.DEPLOY_TREND_TELEMETRY_MIN_ROUTE_ATTEMPTS = '1';
  process.env.DEPLOY_TREND_TELEMETRY_MIN_BUCKETS = '1';

  const runId = uuidv4();
  const source = 'test-deploy-trend-telemetry-alert-suppression-trend';
  const sink = new DeployEventSink({ runId, source });
  const db = new DatabaseStorageManager();

  try {
    const marker = { test_suite: 'deploy_trend_telemetry_alert_suppression_trend' };
    const now = Date.now();

    for (let i = 0; i < 8; i += 1) {
      await sink.write({
        event: i % 2 === 0 ? 'wrapper.abort' : 'wrapper.step',
        level: i < 6 ? 'error' : 'warn',
        ts: new Date(now - (i * 60_000)).toISOString(),
        ...marker
      });
    }

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      // Seed deploy-trend anomaly telemetry
      const seed1 = await fetch(`${base}/jobs/deploy-events/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&route=true&emitAudit=true`);
      assert(seed1.status === 200, `seed anomaly call #1 expected 200, got ${seed1.status}`);

      const seed2 = await fetch(`${base}/jobs/deploy-events/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&route=true&emitAudit=true`);
      assert(seed2.status === 200, `seed anomaly call #2 expected 200, got ${seed2.status}`);

      // First alert route should pass
      const firstAlert = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60&route=true&emitAudit=true`);
      assert(firstAlert.status === 200, `first telemetry alert expected 200, got ${firstAlert.status}`);

      // Second alert route should be suppression-blocked (duplicate/cooldown)
      const secondAlert = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60&route=true&emitAudit=true`);
      assert(secondAlert.status === 200, `second telemetry alert expected 200, got ${secondAlert.status}`);

      const trendRes = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts/suppression/trend?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60`);
      assert(trendRes.status === 200, `suppression trend endpoint expected 200, got ${trendRes.status}`);
      const trendBody = await trendRes.json();

      assert(trendBody.ok === true, 'suppression trend payload ok should be true');
      assert(trendBody.trend?.bucket_count >= 1, 'suppression trend should include at least one bucket');
      assert(trendBody.trend?.totals?.route_candidate >= 1, 'suppression trend totals should include route candidate count');
      assert(trendBody.trend?.totals?.route_attempted >= 1, 'suppression trend totals should include route attempts');
      assert(trendBody.trend?.totals?.route_suppressed_total >= 1, 'suppression trend totals should include suppressed routes');

      const reasonTotal = Number(trendBody.trend.totals.route_suppressed_cooldown || 0)
        + Number(trendBody.trend.totals.route_suppressed_duplicate_window || 0)
        + Number(trendBody.trend.totals.route_suppressed_other || 0);

      assert(
        reasonTotal === Number(trendBody.trend.totals.route_suppressed_total || 0),
        'suppression reason totals should match route_suppressed_total'
      );

      const firstBucket = trendBody.trend.buckets[0] || {};
      assert(typeof firstBucket.route_suppressed_duplicate_window === 'number', 'bucket should include duplicate_window counter');
      assert(typeof firstBucket.route_suppressed_cooldown === 'number', 'bucket should include cooldown counter');

      const bad = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts/suppression/trend?bucketLimit=0`);
      assert(bad.status === 400, `invalid bucketLimit expected 400, got ${bad.status}`);

      console.log('✅ deploy trend telemetry alert suppression trend test passed');
    } finally {
      await shutdown();
    }

    await db.ensureDeployRunEventsTable();
    await db.postgres.query(`DELETE FROM deploy_run_events WHERE payload->>'test_suite' = 'deploy_trend_telemetry_alert_suppression_trend'`);
    await db.redis.del(process.env.DEPLOY_TREND_TELEMETRY_ALERT_STATE_KEY).catch(() => {});
    await db.redis.del(process.env.DEPLOY_TREND_SUPPRESSION_STATE_KEY).catch(() => {});
  } finally {
    await sink.close().catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ deploy trend telemetry alert suppression trend test failed:', err.message);
  process.exit(1);
});
