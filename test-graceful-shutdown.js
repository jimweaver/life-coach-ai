#!/usr/bin/env node

require('dotenv').config();
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  // keep test resilient to rate limit side effects
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';
  process.env.SHUTDOWN_GRACE_MS = '1500';

  const { shutdown } = await createServer();
  const base = 'http://localhost:8787';

  try {
    const ready = await fetch(`${base}/ready`);
    assert(ready.status === 200, `expected /ready 200, got ${ready.status}`);

    const readyBody = await ready.json();
    assert(readyBody.ok === true, 'ready payload expected ok=true');
    assert(readyBody.accepting_traffic === true, 'server should accept traffic before shutdown');

    // idempotency: both shutdown calls should resolve without error
    await Promise.all([
      shutdown(),
      shutdown()
    ]);

    let closed = false;
    try {
      await fetch(`${base}/ready`);
    } catch (_err) {
      closed = true;
    }

    assert(closed, 'server should be closed after shutdown');

    console.log('✅ graceful shutdown test passed');
  } finally {
    // best effort in case assertions fail before shutdown call
    await shutdown().catch(() => {});
  }
}

run().catch((err) => {
  console.error('❌ graceful shutdown test failed:', err.message);
  process.exit(1);
});
