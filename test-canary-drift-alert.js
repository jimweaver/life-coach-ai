#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const createServer = require('./core/api-server');
const DatabaseStorageManager = require('./core/storage/database-storage');
const { appendHistory } = require('./scripts/canary-check');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  // isolate from rate-limit noise
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lifecoach-canary-drift-'));
  const historyFile = path.join(tmpDir, 'history.jsonl');

  try {
    // Seed history with stable low latency baseline
    for (let i = 0; i < 8; i += 1) {
      await appendHistory(historyFile, {
        ok: true,
        rollback_recommended: false,
        request_count: 3,
        metrics: {
          error_rate: i % 4 === 0 ? 0.05 : 0,
          p95_ms: 1100 + i * 60,
          avg_ms: 800 + i * 40
        },
        thresholds: {
          max_error_rate: 0.2,
          max_p95_ms: 3500,
          max_avg_ms: 2200
        }
      });
    }

    process.env.CANARY_HISTORY_FILE = historyFile;

    // Deliberately far from suggested baseline to trigger drift
    process.env.CANARY_MAX_ERROR_RATE = '0.5';
    process.env.CANARY_P95_MAX_MS = '10000';
    process.env.CANARY_AVG_MAX_MS = '9000';

    process.env.CANARY_PROFILE_MIN_SAMPLES = '5';
    process.env.CANARY_DRIFT_WARN_RATIO = '0.2';
    process.env.CANARY_DRIFT_CRITICAL_RATIO = '0.4';
    process.env.CANARY_DRIFT_ROUTE_ENABLED = 'true';
    process.env.CANARY_DRIFT_ROUTE_MIN_LEVEL = 'warn';

    const { shutdown } = await createServer();

    try {
      const base = 'http://localhost:8787';
      const res = await fetch(`${base}/jobs/canary/drift?route=false&emitAudit=true&minSamples=5`);
      assert(res.status === 200, `expected 200, got ${res.status}`);

      const payload = await res.json();
      assert(payload.ok === true, 'payload.ok should be true');
      assert(payload.profile?.ready === true, 'profile should be ready');
      assert(payload.drift?.drift_detected === true, 'expected drift_detected=true');
      assert(['warn', 'critical'].includes(payload.drift?.level), `unexpected drift level: ${payload.drift?.level}`);
      assert(Array.isArray(payload.drift?.reasons) && payload.drift.reasons.length > 0, 'drift reasons should be non-empty');
      assert(payload.route?.attempted === false, 'route should not be attempted when route=false query passed');

      const hasLatencyReason = payload.drift.reasons.some((r) => r.includes('max_p95_ms') || r.includes('max_avg_ms'));
      assert(hasLatencyReason, 'expected latency-related drift reason');

      const db = new DatabaseStorageManager();
      try {
        const logs = await db.getAgentLogs('canary-monitor', 20);
        const driftLog = logs.find((x) => x.action === 'canary_profile_drift_detected');
        assert(!!driftLog, 'expected canary_profile_drift_detected audit log');
      } finally {
        await db.close();
      }

      console.log('✅ canary drift alert test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((err) => {
  console.error('❌ canary drift alert test failed:', err.message);
  process.exit(1);
});
