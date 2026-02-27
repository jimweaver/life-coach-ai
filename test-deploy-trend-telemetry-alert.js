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
  process.env.DEPLOY_TREND_SUPPRESSION_STATE_KEY = `lifecoach:test:deploy-trend-telemetry-alert:${Date.now()}:${process.pid}`;

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
  process.env.DEPLOY_TREND_TELEMETRY_ALERT_STATE_KEY = `lifecoach:test:deploy-trend-telemetry-alert:alert:${Date.now()}:${process.pid}`;

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
  const source = 'test-deploy-trend-telemetry-alert';
  const sink = new DeployEventSink({ runId, source });
  const db = new DatabaseStorageManager();

  try {
    const marker = { test_suite: 'deploy_trend_telemetry_alert' };
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
      const first = await fetch(`${base}/jobs/deploy-events/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&route=true&emitAudit=true`);
      assert(first.status === 200, `first anomaly call expected 200, got ${first.status}`);

      const second = await fetch(`${base}/jobs/deploy-events/anomalies?runId=${runId}&source=${source}&sinceMinutes=360&route=true&emitAudit=true`);
      assert(second.status === 200, `second anomaly call expected 200, got ${second.status}`);

      const alertRes = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts?runId=${runId}&source=${source}&sinceMinutes=360&bucketMinutes=60&route=true&emitAudit=true`);
      assert(alertRes.status === 200, `telemetry alert endpoint expected 200, got ${alertRes.status}`);
      const alertBody = await alertRes.json();

      assert(alertBody.ok === true, 'telemetry alert payload ok should be true');
      assert(alertBody.alert?.alert_detected === true, 'telemetry alert should detect saturation/spike');
      assert(alertBody.route?.candidate === true, 'telemetry alert route candidate should be true');
      assert(alertBody.routed?.attempted === true, 'telemetry alert should attempt route');

      const reasons = Array.isArray(alertBody.alert?.reasons) ? alertBody.alert.reasons : [];
      const hasExpectedReason = reasons.includes('route_failure_saturation') || reasons.includes('suppression_saturation');
      assert(hasExpectedReason, `expected saturation reason, got: ${reasons.join(',')}`);

      const bad = await fetch(`${base}/jobs/deploy-events/anomalies/telemetry/alerts?bucketMinutes=0`);
      assert(bad.status === 400, `invalid bucketMinutes should return 400, got ${bad.status}`);

      const logs = await db.getAgentLogs('deploy-trend', 80);
      const auditHit = logs.find((x) => x.action === 'deploy_trend_telemetry_alert_detected');
      assert(!!auditHit, 'expected deploy_trend_telemetry_alert_detected audit log');

      console.log('✅ deploy trend telemetry alert test passed');
    } finally {
      await shutdown();
    }

    await db.ensureDeployRunEventsTable();
    await db.postgres.query(`DELETE FROM deploy_run_events WHERE payload->>'test_suite' = 'deploy_trend_telemetry_alert'`);
    await db.redis.del(process.env.DEPLOY_TREND_TELEMETRY_ALERT_STATE_KEY).catch(() => {});
  } finally {
    await sink.close().catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ deploy trend telemetry alert test failed:', err.message);
  process.exit(1);
});
