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

  process.env.DEPLOY_TREND_ANOMALY_WARN_ERROR_RATE = '0.2';
  process.env.DEPLOY_TREND_ANOMALY_CRITICAL_ERROR_RATE = '0.4';
  process.env.DEPLOY_TREND_ANOMALY_WARN_ABORT_RATIO = '0.1';
  process.env.DEPLOY_TREND_ANOMALY_CRITICAL_ABORT_RATIO = '0.25';

  const runA = uuidv4();
  const runB = uuidv4();

  const sinkA = new DeployEventSink({ runId: runA, source: 'anomaly-source-a' });
  const sinkB = new DeployEventSink({ runId: runB, source: 'anomaly-source-b' });

  const db = new DatabaseStorageManager();

  try {
    const marker = { test_suite: 'deploy_trend_anomaly' };
    const now = Date.now();

    // run A: intentionally noisy (high error ratio + abort)
    for (let i = 0; i < 6; i += 1) {
      await sinkA.write({
        event: i % 2 === 0 ? 'wrapper.abort' : 'wrapper.step',
        level: i < 4 ? 'error' : 'warn',
        ts: new Date(now - i * 60_000).toISOString(),
        ...marker,
        run_label: 'A'
      });
    }

    // run B: mostly healthy
    await sinkB.write({ event: 'wrapper.start', level: 'info', ts: new Date(now - 10 * 60_000).toISOString(), ...marker, run_label: 'B' });
    await sinkB.write({ event: 'wrapper.complete', level: 'info', ts: new Date(now - 9 * 60_000).toISOString(), ...marker, run_label: 'B' });

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const res = await fetch(`${base}/jobs/deploy-events/anomalies?sinceMinutes=360&bucketMinutes=30&route=false`);
      assert(res.status === 200, `anomaly endpoint expected 200, got ${res.status}`);

      const body = await res.json();
      assert(body.ok === true, 'anomaly payload ok should be true');
      assert(body.anomaly?.anomaly_detected === true, 'expected anomaly_detected=true');
      assert(['warn', 'critical'].includes(body.anomaly?.level), `unexpected anomaly level ${body.anomaly?.level}`);
      assert(Array.isArray(body.anomaly?.reasons) && body.anomaly.reasons.length >= 1, 'expected anomaly reasons');

      const hasRunErrorOrAbort = body.anomaly.reasons.includes('run_error_rate') || body.anomaly.reasons.includes('abort_ratio');
      assert(hasRunErrorOrAbort, 'expected run_error_rate or abort_ratio anomaly reason');

      const bad = await fetch(`${base}/jobs/deploy-events/anomalies?bucketMinutes=0`);
      assert(bad.status === 400, `invalid bucketMinutes should return 400, got ${bad.status}`);

      // audit signal should be written when anomaly detected
      const logs = await db.getAgentLogs('deploy-trend', 40);
      const hit = logs.find((x) => x.action === 'deploy_trend_anomaly_detected');
      assert(!!hit, 'expected deploy_trend_anomaly_detected audit log');

      console.log('✅ deploy trend anomaly test passed');
    } finally {
      await shutdown();
    }

    await db.ensureDeployRunEventsTable();
    await db.postgres.query(
      `DELETE FROM deploy_run_events WHERE payload->>'test_suite' = 'deploy_trend_anomaly'`
    );
  } finally {
    await Promise.allSettled([sinkA.close(), sinkB.close()]);
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ deploy trend anomaly test failed:', err.message);
  process.exit(1);
});
