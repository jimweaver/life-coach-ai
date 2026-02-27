#!/usr/bin/env node

require('dotenv').config();
const createServer = require('./core/api-server');
const { runCanary } = require('./scripts/canary-check');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const { shutdown } = await createServer();

  try {
    const report = await runCanary({
      baseUrl: 'http://localhost:8787',
      requestCount: 2,
      timeoutMs: 10000,
      maxErrorRate: 0.5,
      maxP95Ms: 8000,
      maxAvgMs: 6000,
      persist: false
    });

    assert(report.ok === true, 'expected canary report ok=true');
    assert(report.metrics.total === 2, `expected total=2, got ${report.metrics.total}`);
    assert(report.metrics.success >= 1, `expected at least one success, got ${report.metrics.success}`);
    assert(typeof report.rollback_recommended === 'boolean', 'rollback_recommended should be boolean');

    console.log('✅ canary check test passed');
  } finally {
    await shutdown();
  }
}

run().catch((err) => {
  console.error('❌ canary check test failed:', err.message);
  process.exit(1);
});
