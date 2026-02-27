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
  // avoid unrelated middleware side effects
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const runA = uuidv4();
  const runB = uuidv4();

  const sinkA = new DeployEventSink({ runId: runA, source: 'trend-source-a' });
  const sinkB = new DeployEventSink({ runId: runB, source: 'trend-source-b' });

  const db = new DatabaseStorageManager();

  try {
    const marker = { test_suite: 'deploy_event_trend' };

    const now = Date.now();
    const ts0 = new Date(now).toISOString();
    const ts1 = new Date(now - 20 * 60_000).toISOString();
    const ts2 = new Date(now - 95 * 60_000).toISOString();

    await sinkA.write({ event: 'wrapper.start', level: 'info', ts: ts0, ...marker, run_label: 'A' });
    await sinkA.write({ event: 'smoke.quick.end', level: 'warn', ts: ts1, ...marker, run_label: 'A' });
    await sinkA.write({ event: 'wrapper.abort', level: 'error', ts: ts2, ...marker, run_label: 'A' });

    await sinkB.write({ event: 'wrapper.start', level: 'info', ts: ts0, ...marker, run_label: 'B' });
    await sinkB.write({ event: 'canary.traffic.end', level: 'info', ts: ts1, ...marker, run_label: 'B' });
    await sinkB.write({ event: 'wrapper.complete', level: 'info', ts: ts0, ...marker, run_label: 'B' });

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const trendRes = await fetch(`${base}/jobs/deploy-events/trend?sinceMinutes=360&bucketMinutes=30&runLimit=20&timelineLimit=200&heatmapLimit=50`);
      assert(trendRes.status === 200, `trend endpoint expected 200, got ${trendRes.status}`);

      const trend = await trendRes.json();
      assert(trend.ok === true, 'trend payload should be ok=true');
      assert(Array.isArray(trend.runs) && trend.runs.length >= 2, `expected runs length >=2, got ${trend.runs?.length}`);
      assert(Array.isArray(trend.timeline) && trend.timeline.length >= 2, `expected timeline length >=2, got ${trend.timeline?.length}`);
      assert(Array.isArray(trend.heatmap?.rows) && trend.heatmap.rows.length >= 1, 'expected non-empty heatmap rows');
      assert(Number(trend.heatmap?.totals?.error || 0) >= 1, 'expected heatmap total error >=1');
      assert(Number(trend.heatmap?.totals?.warn || 0) >= 1, 'expected heatmap total warn >=1');

      const runFilterRes = await fetch(`${base}/jobs/deploy-events/trend?runId=${runA}&sinceMinutes=360`);
      assert(runFilterRes.status === 200, `trend run filter expected 200, got ${runFilterRes.status}`);
      const runFilter = await runFilterRes.json();
      assert(runFilter.runs.every((r) => r.run_id === runA), 'run filter should only include runA in runs');
      assert(runFilter.timeline.every((t) => t.run_id === runA), 'run filter should only include runA in timeline');

      const sourceFilterRes = await fetch(`${base}/jobs/deploy-events/trend?source=trend-source-b&sinceMinutes=360`);
      assert(sourceFilterRes.status === 200, `trend source filter expected 200, got ${sourceFilterRes.status}`);
      const sourceFilter = await sourceFilterRes.json();
      assert(sourceFilter.runs.every((r) => r.source === 'trend-source-b'), 'source filter should only include source-b in runs');

      const bad = await fetch(`${base}/jobs/deploy-events/trend?bucketMinutes=0`);
      assert(bad.status === 400, `invalid bucketMinutes should return 400, got ${bad.status}`);

      console.log('✅ deploy event trend test passed');
    } finally {
      await shutdown();
    }

    await db.ensureDeployRunEventsTable();
    await db.postgres.query(
      `DELETE FROM deploy_run_events WHERE payload->>'test_suite' = 'deploy_event_trend'`
    );
  } finally {
    await Promise.allSettled([sinkA.close(), sinkB.close()]);
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ deploy event trend test failed:', err.message);
  process.exit(1);
});
