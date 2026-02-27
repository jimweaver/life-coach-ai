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
  process.env.DEPLOY_TREND_SUPPRESSION_STATE_KEY = `lifecoach:test:deploy-trend-telemetry-trend:${Date.now()}:${process.pid}`;

  process.env.DEPLOY_TREND_ANOMALY_WARN_ERROR_RATE = '0.1';
  process.env.DEPLOY_TREND_ANOMALY_CRITICAL_ERROR_RATE = '0.2';

  const runId = uuidv4();
  const source = 'test-deploy-trend-telemetry-trend';
  const sink = new DeployEventSink({ runId, source });
  const db = new DatabaseStorageManager();

  try {
    const marker = { test_suite: 'deploy_trend_telemetry_trend' };
    const now = Date.now();

    for (let i = 0; i < 10; i += 1) {
      await sink.write({
        event: i % 2 === 0 ? 'wrapper.abort' : 'wrapper.step',
        level: i < 7 ? 'error' : 'warn',
        ts: new Date(now - (i * 90_000)).toISOString(),
        ...marker
      });
    }

    await sink.write({ event: 'wrapper.complete', level: 'info', ts: new Date(now - (20 * 60_000)).toISOString(), ...marker });

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const first = await fetch(`${base}/jobs/deploy-events/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&route=true&emitAudit=true`);
      assert(first.status === 200, `first anomaly call expected 200, got ${first.status}`);
      const firstBody = await first.json();
      assert(firstBody.ok === true, 'first anomaly payload ok should be true');
      assert(firstBody.anomaly?.anomaly_detected === true, 'first anomaly should detect drift');

      const second = await fetch(`${base}/jobs/deploy-events/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&route=true&emitAudit=true`);
      assert(second.status === 200, `second anomaly call expected 200, got ${second.status}`);
      const secondBody = await second.json();
      assert(secondBody.ok === true, 'second anomaly payload ok should be true');
      assert(secondBody.route?.suppressed === true, 'second anomaly call should be suppressed');

      const trendRes = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/trend?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60`);
      assert(trendRes.status === 200, `telemetry trend endpoint expected 200, got ${trendRes.status}`);
      const trendBody = await trendRes.json();

      assert(trendBody.ok === true, 'telemetry trend payload ok should be true');
      assert(trendBody.trend?.bucket_minutes === 60, 'trend bucket_minutes should equal requested value');
      assert(trendBody.trend?.bucket_count >= 1, 'trend should include at least one bucket');
      assert(Array.isArray(trendBody.trend?.buckets), 'trend buckets should be an array');

      const detectedTotal = trendBody.trend.buckets.reduce((acc, b) => acc + Number(b.detected || 0), 0);
      const suppressedTotal = trendBody.trend.buckets.reduce((acc, b) => acc + Number(b.suppressed || 0), 0);
      assert(detectedTotal >= 2, `expected detectedTotal >= 2, got ${detectedTotal}`);
      assert(suppressedTotal >= 1, `expected suppressedTotal >= 1, got ${suppressedTotal}`);

      const dashboardRes = await fetch(`${base}/jobs/deploy-events/dashboard?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60&includeTelemetryTrend=true`);
      assert(dashboardRes.status === 200, `dashboard endpoint expected 200, got ${dashboardRes.status}`);
      const dashboardBody = await dashboardRes.json();
      assert(dashboardBody.ok === true, 'dashboard payload ok should be true');
      assert(!!dashboardBody.anomaly_telemetry_trend, 'dashboard should include anomaly_telemetry_trend block');
      assert(dashboardBody.anomaly_telemetry_trend.bucket_minutes === 60, 'dashboard trend bucket_minutes should be 60');

      const bad = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/trend?bucketLimit=0`);
      assert(bad.status === 400, `invalid bucketLimit should return 400, got ${bad.status}`);

      console.log('✅ deploy trend telemetry trend test passed');
    } finally {
      await shutdown();
    }

    await db.ensureDeployRunEventsTable();
    await db.postgres.query(`DELETE FROM deploy_run_events WHERE payload->>'test_suite' = 'deploy_trend_telemetry_trend'`);
  } finally {
    await sink.close().catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ deploy trend telemetry trend test failed:', err.message);
  process.exit(1);
});
