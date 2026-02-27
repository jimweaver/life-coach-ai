#!/usr/bin/env node

require('dotenv').config();
const createServer = require('./core/api-server');
const DatabaseStorageManager = require('./core/storage/database-storage');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function run() {
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_MAX = '10';
  process.env.RATE_LIMIT_MAX_CHAT = '2';
  process.env.RATE_LIMIT_MAX_JOBS = '1';
  process.env.RATE_LIMIT_MAX_INTERVENTION = '5';
  process.env.RATE_LIMIT_KEY_PREFIX = `lifecoach:test:policy:${Date.now()}:${process.pid}`;

  const { shutdown } = await createServer();
  const base = 'http://localhost:8787';

  try {
    // CHAT bucket: limit=2
    const c1 = await postJson(`${base}/chat`, { user_id: 'bad', message: '' });
    const c2 = await postJson(`${base}/chat`, { user_id: 'bad', message: '' });
    const c3 = await postJson(`${base}/chat`, { user_id: 'bad', message: '' });

    assert(c1.status === 400, `chat #1 expected 400, got ${c1.status}`);
    assert(c2.status === 400, `chat #2 expected 400, got ${c2.status}`);
    assert(c3.status === 429, `chat #3 expected 429, got ${c3.status}`);

    // JOBS bucket: limit=1
    const j1 = await postJson(`${base}/jobs/run-monitor-cycle`, { limitUsers: 1 });
    const j2 = await postJson(`${base}/jobs/run-monitor-cycle`, { limitUsers: 1 });

    assert(j1.status === 200, `jobs #1 expected 200, got ${j1.status}`);
    assert(j2.status === 429, `jobs #2 expected 429, got ${j2.status}`);

    // verify alert-hook audit logs were written
    const db = new DatabaseStorageManager();
    try {
      const logs = await db.getAgentLogs('rate-limit-guard', 50);
      assert(logs.length > 0, 'expected rate-limit-guard logs');

      const hasChatBucket = logs.some((l) => l.action === 'rate_limit_exceeded' && l.metadata?.bucket === 'chat');
      const hasJobsBucket = logs.some((l) => l.action === 'rate_limit_exceeded' && l.metadata?.bucket === 'jobs');

      assert(hasChatBucket, 'missing rate-limit audit log for chat bucket');
      assert(hasJobsBucket, 'missing rate-limit audit log for jobs bucket');
    } finally {
      await db.close();
    }

    console.log('✅ rate-limit policy test passed');
  } finally {
    await shutdown();
  }
}

run().catch((err) => {
  console.error('❌ rate-limit policy test failed:', err.message);
  process.exit(1);
});
