#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { normalizeAuditEvent } = require('./core/audit-log');
const DatabaseStorageManager = require('./core/storage/database-storage');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testNormalizationUnit() {
  const normalized = normalizeAuditEvent({
    agentId: '  KBI Monitor ### ',
    userId: 'not-a-uuid',
    sessionId: 'also-bad',
    action: 'Scheduled Monitor Cycle!!!',
    durationMs: -10,
    status: 'unknown',
    errorMessage: 'x'.repeat(2500),
    metadata: {
      apiKey: 'SECRET',
      nested: {
        password: 'p@ss',
        note: 'safe'
      }
    }
  });

  assert(normalized.agentId === 'kbi_monitor', `agentId normalization failed: ${normalized.agentId}`);
  assert(normalized.userId === null, 'invalid userId should normalize to null');
  assert(normalized.sessionId === null, 'invalid sessionId should normalize to null');
  assert(normalized.action === 'scheduled_monitor_cycle', `action normalization failed: ${normalized.action}`);
  assert(normalized.durationMs === null, 'negative duration should normalize to null');
  assert(normalized.status === 'failure', 'unknown status should normalize to failure');
  assert(normalized.errorMessage.length <= 2001, 'error message should be trimmed');
  assert(normalized.metadata.apiKey === '[REDACTED]', 'apiKey should be redacted');
  assert(normalized.metadata.nested.password === '[REDACTED]', 'nested password should be redacted');
  assert(normalized.metadata._audit?.normalized === true, 'metadata audit marker missing');
}

async function testDbIntegration() {
  const db = new DatabaseStorageManager();
  const userId = uuidv4();

  try {
    await db.createUserProfile(userId, { name: 'audit-test-user' });

    await db.logAgentAction(
      'KBI Monitor ###',
      userId,
      'invalid-session-id',
      'Scheduled Monitor Cycle!!!',
      -99,
      'random-status',
      'integration test error message',
      {
        authorization: 'Bearer 123',
        payload: { token: 'abc', note: 'ok' }
      }
    );

    const logs = await db.getAgentLogs('kbi_monitor', 5);
    assert(logs.length > 0, 'expected at least one normalized audit log');

    const hit = logs.find((x) => x.user_id === userId);
    assert(!!hit, 'expected normalized log row for test user');
    assert(hit.status === 'failure', 'status should normalize to failure');
    assert(hit.session_id === null, 'invalid sessionId should be stored as null');
    assert(hit.duration_ms === null, 'invalid duration should be stored as null');
    assert(hit.action === 'scheduled_monitor_cycle', `action should be normalized, got ${hit.action}`);
    assert(hit.metadata.authorization === '[REDACTED]', 'authorization should be redacted in db metadata');
    assert(hit.metadata.payload.token === '[REDACTED]', 'nested token should be redacted in db metadata');

    console.log('✅ audit log normalization test passed');
  } finally {
    await db.close();
  }
}

async function run() {
  testNormalizationUnit();
  await testDbIntegration();
}

run().catch((err) => {
  console.error('❌ audit log normalization test failed:', err.message);
  process.exit(1);
});
