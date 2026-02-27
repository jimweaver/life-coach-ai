#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('../core/storage/database-storage');

const baseUrl = process.env.SMOKE_CHECK_BASE_URL || 'http://localhost:8787';
const timeoutMs = Number(process.env.SMOKE_CHECK_TIMEOUT_MS || 5000);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal
    });
    clearTimeout(t);
    return res;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

async function run() {
  const errors = [];

  // 1. Health check
  try {
    const res = await fetchWithTimeout(`${baseUrl}/health`);
    if (res.status !== 200) throw new Error(`health status ${res.status}`);
    const body = await res.json();
    if (body.ok !== true) throw new Error('health ok=false');
    if (!body.services?.redis || !body.services?.postgres) {
      throw new Error(`services unhealthy`);
    }
    console.log('✅ health check passed');
  } catch (err) {
    errors.push(`health: ${err.message}`);
  }

  // 2. Direct DB connectivity
  let db;
  try {
    db = new DatabaseStorageManager();
    const status = await db.testConnections();
    if (!status.redis || !status.postgres) {
      throw new Error(`direct DB check failed: redis=${status.redis}, postgres=${status.postgres}`);
    }
    console.log('✅ direct DB connectivity passed');
  } catch (err) {
    errors.push(`db-connect: ${err.message}`);
  }

  // 3. Write + read roundtrip
  let testUserId = null;
  try {
    testUserId = uuidv4();
    await db.createUserProfile(testUserId, { name: 'smoke-test-user', created_at: new Date().toISOString() });
    const profile = await db.getUserProfile(testUserId);
    if (!profile || profile.name !== 'smoke-test-user') {
      throw new Error('profile roundtrip mismatch');
    }
    console.log('✅ DB write/read roundtrip passed');
  } catch (err) {
    errors.push(`db-roundtrip: ${err.message}`);
  }

  // 4. Key API endpoints
  try {
    const chatRes = await fetchWithTimeout(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId || uuidv4(),
        message: 'smoke test'
      })
    });
    if (chatRes.status !== 200) throw new Error(`chat status ${chatRes.status}`);
    console.log('✅ chat endpoint passed');
  } catch (err) {
    errors.push(`chat: ${err.message}`);
  }

  // Cleanup
  try {
    if (testUserId) {
      await db.postgres.query('DELETE FROM user_profiles WHERE user_id = $1', [testUserId]);
    }
    await db.close();
  } catch (_e) {
    // best effort cleanup
  }

  if (errors.length) {
    console.error('❌ deep smoke check failed:');
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
  }

  console.log('✅ deep smoke check passed');
}

run().catch((err) => {
  console.error('❌ deep smoke check fatal:', err.message);
  process.exit(1);
});
