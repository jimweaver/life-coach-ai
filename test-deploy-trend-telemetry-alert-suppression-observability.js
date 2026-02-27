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
  process.env.DEPLOY_TREND_SUPPRESSION_STATE_KEY = `lifecoach:test:deploy-trend-telemetry-alert-suppress-observe:anomaly:${Date.now()}:${process.pid}`;

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
  process.env.DEPLOY_TREND_TELEMETRY_ALERT_STATE_KEY = `lifecoach:test:deploy-trend-telemetry-alert-suppress-observe:alert:${Date.now()}:${process.pid}`;

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
  const source = 'test-deploy-trend-telemetry-alert-suppress-observe';
  const sink = new DeployEventSink({ runId, source });
  const db = new DatabaseStorageManager();

  try {
    const marker = { test_suite: 'deploy_trend_telemetry_alert_suppression_observability' };
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
      // Seed deploy-trend anomaly telemetry and establish first telemetry-alert route state.
      const seed1 = await fetch(`${base}/jobs/deploy-events/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&route=true&emitAudit=true`);
      assert(seed1.status === 200, `seed anomaly call #1 expected 200, got ${seed1.status}`);

      const seed2 = await fetch(`${base}/jobs/deploy-events/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&route=true&emitAudit=true`);
      assert(seed2.status === 200, `seed anomaly call #2 expected 200, got ${seed2.status}`);

      const prime = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60&route=true&emitAudit=true`);
      assert(prime.status === 200, `prime telemetry alert call expected 200, got ${prime.status}`);
      const primeBody = await prime.json();
      assert(primeBody.route?.candidate === true, 'prime route should be candidate');
      assert(primeBody.route?.suppressed === false, 'prime route should not be suppressed');
      assert(primeBody.routed?.attempted === true, 'prime route should attempt routing');

      const obs = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts/suppression?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60`);
      assert(obs.status === 200, `suppression observability endpoint expected 200, got ${obs.status}`);
      const body = await obs.json();

      assert(body.ok === true, 'suppression observability payload ok should be true');
      assert(body.alert?.alert_detected === true, 'suppression observability should detect alert');
      assert(body.route?.candidate === true, 'suppression observability should be route candidate');
      assert(body.suppression?.enabled === true, 'suppression should be enabled');
      assert(body.suppression?.suppressed === true, 'suppression should be active after prime route');
      assert(
        ['cooldown', 'duplicate_window'].includes(body.suppression?.reason),
        `unexpected suppression reason ${body.suppression?.reason}`
      );
      assert(body.trend_summary?.bucket_count >= 1, 'trend summary should include buckets');

      const routeDisabled = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts/suppression?runId=${runId}&source=${source}&route=false`);
      assert(routeDisabled.status === 200, `route=false suppression snapshot expected 200, got ${routeDisabled.status}`);
      const routeDisabledBody = await routeDisabled.json();
      assert(routeDisabledBody.route?.candidate === false, 'route=false should not be candidate');
      assert(routeDisabledBody.suppression?.reason === 'route_not_candidate', 'route=false should produce route_not_candidate reason');

      const bad = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts/suppression?bucketMinutes=0`);
      assert(bad.status === 400, `invalid bucketMinutes should return 400, got ${bad.status}`);

      console.log('✅ deploy trend telemetry alert suppression observability test passed');
    } finally {
      await shutdown();
    }

    await db.ensureDeployRunEventsTable();
    await db.postgres.query(`DELETE FROM deploy_run_events WHERE payload->>'test_suite' = 'deploy_trend_telemetry_alert_suppression_observability'`);
    await db.redis.del(process.env.DEPLOY_TREND_TELEMETRY_ALERT_STATE_KEY).catch(() => {});
  } finally {
    await sink.close().catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ deploy trend telemetry alert suppression observability test failed:', err.message);
  process.exit(1);
});
