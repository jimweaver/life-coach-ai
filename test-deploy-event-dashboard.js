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

  const runA = uuidv4();
  const runB = uuidv4();

  const sinkA = new DeployEventSink({ runId: runA, source: 'dashboard-test-A' });
  const sinkB = new DeployEventSink({ runId: runB, source: 'dashboard-test-B' });
  const db = new DatabaseStorageManager();

  try {
    const now = Date.now();
    const marker = { test_suite: 'deploy_event_dashboard' };

    for (let i = 0; i < 4; i += 1) {
      await sinkA.write({
        event: 'preflight.start',
        level: 'info',
        ts: new Date(now - (i * 120000)).toISOString(),
        ...marker
      });
    }

    for (let i = 0; i < 3; i += 1) {
      await sinkB.write({
        event: 'smoke.quick.end',
        level: 'warn',
        ts: new Date(now - (i * 180000)).toISOString(),
        ...marker
      });
    }

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const url = `${base}/jobs/deploy-events/dashboard?runId=${runA}&sinceMinutes=60&bucketMinutes=15&timelineLimit=50&heatmapLimit=50`;
      const res = await fetch(url);
      assert(res.status === 200, `dashboard endpoint expected 200, got ${res.status}`);
      const body = await res.json();
      assert(body.ok === true, 'dashboard payload ok should be true');
      assert(body.timeline?.length >= 1, 'timeline must return entries');
      assert(body.heatmap?.rows?.length >= 1, 'heatmap should return rows');
      assert(body.summary?.length >= 0, 'summary should return array');

      const runBRes = await fetch(`${base}/jobs/deploy-events/dashboard?runId=${runB}&sinceMinutes=60`);
      assert(runBRes.status === 200, `dashboard runB expected 200, got ${runBRes.status}`);
      const runBBody = await runBRes.json();
      assert(runBBody.filters.runId === runB, 'filters should reflect runId');
      assert(runBBody.heatmap.totals.total >= 3, 'heatmap totals should count runB events');

      console.log('✅ deploy event dashboard test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await Promise.all([sinkA.close(), sinkB.close()]);
    await db.postgres.query(`DELETE FROM deploy_run_events WHERE payload->>'test_suite' = 'deploy_event_dashboard'`).catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ deploy event dashboard test failed:', err.message);
  process.exit(1);
});
