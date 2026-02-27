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
  process.env.DEPLOY_TREND_SUPPRESSION_STATE_KEY = `lifecoach:test:deploy-trend-telemetry-suppression-alert-suppression:anomaly:${Date.now()}:${process.pid}`;

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
  process.env.DEPLOY_TREND_TELEMETRY_ALERT_STATE_KEY = `lifecoach:test:deploy-trend-telemetry-suppression-alert-suppression:telemetry:${Date.now()}:${process.pid}`;

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

  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_ROUTE_ENABLED = 'true';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_ROUTE_MIN_LEVEL = 'warn';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_ROUTE_USER_ID = uuidv4();
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_ROUTE_CHANNEL = 'cron-event';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_ROUTE_RETRY_MAX = '0';

  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_ENABLED = 'true';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_COOLDOWN_MINUTES = '10';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_DUPLICATE_WINDOW_MINUTES = '10';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_STATE_KEY = `lifecoach:test:deploy-trend-telemetry-suppression-alert-suppression:route:${Date.now()}:${process.pid}`;

  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_WARN_COOLDOWN_SHARE = '0.8';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_CRITICAL_COOLDOWN_SHARE = '0.95';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_WARN_DUPLICATE_SHARE = '0.4';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_CRITICAL_DUPLICATE_SHARE = '0.7';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_WARN_COOLDOWN_SPIKE = '1.2';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_CRITICAL_COOLDOWN_SPIKE = '1.8';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_WARN_DUPLICATE_SPIKE = '1.2';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_CRITICAL_DUPLICATE_SPIKE = '1.8';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_MIN_SUPPRESSED = '1';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_MIN_BUCKETS = '1';
  process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_BASELINE_BUCKETS = '3';

  const runId = uuidv4();
  const source = 'test-deploy-trend-telemetry-suppression-alert-suppression';
  const sink = new DeployEventSink({ runId, source });
  const db = new DatabaseStorageManager();

  try {
    const marker = { test_suite: 'deploy_trend_telemetry_suppression_alert_suppression' };
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
      // Seed anomaly telemetry.
      const seed1 = await fetch(`${base}/jobs/deploy-events/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&route=true&emitAudit=true`);
      assert(seed1.status === 200, `seed anomaly call #1 expected 200, got ${seed1.status}`);

      const seed2 = await fetch(`${base}/jobs/deploy-events/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&route=true&emitAudit=true`);
      assert(seed2.status === 200, `seed anomaly call #2 expected 200, got ${seed2.status}`);

      // Seed telemetry alert suppression trend.
      const t1 = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60&route=true&emitAudit=true`);
      assert(t1.status === 200, `telemetry alert call #1 expected 200, got ${t1.status}`);

      const t2 = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60&route=true&emitAudit=true`);
      assert(t2.status === 200, `telemetry alert call #2 expected 200, got ${t2.status}`);

      const first = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts/suppression/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60&route=true&emitAudit=true`);
      assert(first.status === 200, `first suppression-anomaly call expected 200, got ${first.status}`);
      const firstBody = await first.json();

      assert(firstBody.ok === true, 'first suppression-anomaly payload ok should be true');
      assert(firstBody.alert?.alert_detected === true, 'first suppression-anomaly should detect alert');
      assert(firstBody.route?.candidate === true, 'first suppression-anomaly should be route candidate');
      assert(firstBody.route?.suppressed === false, 'first suppression-anomaly should not be suppressed');
      assert(firstBody.suppression?.suppressed === false, 'first suppression object should not be suppressed');
      assert(firstBody.routed?.attempted === true, 'first suppression-anomaly should route');

      const second = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts/suppression/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60&route=true&emitAudit=true`);
      assert(second.status === 200, `second suppression-anomaly call expected 200, got ${second.status}`);
      const secondBody = await second.json();

      assert(secondBody.route?.candidate === true, 'second suppression-anomaly should remain route candidate');
      assert(secondBody.route?.suppressed === true, 'second suppression-anomaly should be suppressed');
      assert(secondBody.suppression?.suppressed === true, 'second suppression object should indicate suppression');
      assert(
        ['cooldown', 'duplicate_window'].includes(secondBody.suppression?.reason),
        `unexpected suppression reason ${secondBody.suppression?.reason}`
      );

      const logs = await db.getAgentLogs('deploy-trend', 160);
      const suppressionAudit = logs.find((x) => x.action === 'deploy_trend_telemetry_suppression_alert_route_suppressed');
      assert(!!suppressionAudit, 'expected deploy_trend_telemetry_suppression_alert_route_suppressed audit log');

      console.log('✅ deploy trend telemetry suppression alert suppression test passed');
    } finally {
      await shutdown();
    }

    await db.ensureDeployRunEventsTable();
    await db.postgres.query(`DELETE FROM deploy_run_events WHERE payload->>'test_suite' = 'deploy_trend_telemetry_suppression_alert_suppression'`);
    await db.redis.del(process.env.DEPLOY_TREND_TELEMETRY_ALERT_STATE_KEY).catch(() => {});
    await db.redis.del(process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_STATE_KEY).catch(() => {});
    await db.redis.del(process.env.DEPLOY_TREND_SUPPRESSION_STATE_KEY).catch(() => {});
  } finally {
    await sink.close().catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ deploy trend telemetry suppression alert suppression test failed:', err.message);
  process.exit(1);
});
