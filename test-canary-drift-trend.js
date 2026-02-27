#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  // isolate side effects
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  // make current active thresholds intentionally lenient to trigger drift against baseline
  process.env.CANARY_MAX_ERROR_RATE = '0.8';
  process.env.CANARY_P95_MAX_MS = '9000';
  process.env.CANARY_AVG_MAX_MS = '6000';

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lifecoach-canary-trend-'));
  const historyFile = path.join(tmpDir, 'canary-history.jsonl');

  try {
    const now = Date.now();
    const lines = [];

    // 12 points over ~3 hours
    for (let i = 0; i < 12; i += 1) {
      const ts = new Date(now - ((12 - i) * 15 * 60_000)).toISOString();
      const entry = {
        ts,
        ok: true,
        rollback_recommended: false,
        metrics: {
          error_rate: 0.02 + ((i % 3) * 0.005),
          p95_ms: 950 + (i * 20),
          avg_ms: 420 + (i * 10)
        },
        thresholds: {
          max_error_rate: 0.2,
          max_p95_ms: 3500,
          max_avg_ms: 2200
        },
        request_count: 3
      };
      lines.push(JSON.stringify(entry));
    }

    await fs.writeFile(historyFile, `${lines.join('\n')}\n`, 'utf8');

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const url = `${base}/jobs/canary/drift-trend?historyFile=${encodeURIComponent(historyFile)}&sinceMinutes=600&bucketMinutes=30&minSamples=3`;
      const res = await fetch(url);
      assert(res.status === 200, `expected 200 from canary drift trend endpoint, got ${res.status}`);

      const body = await res.json();
      assert(body.ok === true, 'expected ok=true');
      assert(body.history_file === path.resolve(historyFile), 'history_file should be resolved absolute path');
      assert(body.trend?.summary, 'trend.summary missing');
      assert(Array.isArray(body.trend?.buckets), 'trend.buckets should be array');
      assert(body.trend.buckets.length >= 1, 'expected at least one bucket');
      assert(['info', 'warn', 'critical'].includes(body.trend.summary.peak_level), 'invalid peak level');
      assert(typeof body.trend.summary.total_critical === 'number', 'total_critical should be number');

      // With lenient active thresholds against tighter suggested thresholds,
      // drift should appear in at least one bucket after minSamples become ready.
      assert(body.trend.summary.total_drift_detected >= 1, 'expected drift_detected count >= 1');

      const bad = await fetch(`${base}/jobs/canary/drift-trend?bucketMinutes=0`);
      assert(bad.status === 400, `expected 400 for invalid bucketMinutes, got ${bad.status}`);

      console.log('✅ canary drift trend test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((err) => {
  console.error('❌ canary drift trend test failed:', err.message);
  process.exit(1);
});
