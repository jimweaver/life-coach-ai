#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const queueKey = `lifecoach:test:dead-letter-ops-policy:${Date.now()}:${process.pid}`;
  const approvalCode = 'OPS-APPROVAL-CODE';

  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;

  // reduce interference from unrelated middlewares in test
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  // replay safety + ops policy
  process.env.DEADLETTER_REPLAY_MAX_LIMIT = '100';
  process.env.DEADLETTER_REPLAY_APPROVAL_THRESHOLD = '2';
  process.env.DEADLETTER_REPLAY_REQUIRE_APPROVAL = 'true';
  process.env.DEADLETTER_REPLAY_APPROVAL_CODE = approvalCode;

  process.env.DEADLETTER_REPLAY_APPROVER_STRATEGY = 'either';
  process.env.DEADLETTER_REPLAY_APPROVER_ALLOWLIST = 'ops-admin,tj-ops';
  process.env.DEADLETTER_REPLAY_APPROVER_ROLES = 'sre,oncall';

  const db = new DatabaseStorageManager();
  const userId = uuidv4();

  try {
    await db.createUserProfile(userId, { name: 'dead-letter-ops-policy-user' });

    const mkEnvelope = () => ({
      kind: 'systemEvent',
      text: 'dead-letter-ops-policy-test',
      source: 'test-suite',
      event_type: 'scheduled_intervention',
      cycle: 'monitor',
      severity: 'warning',
      user_id: userId,
      timestamp: new Date().toISOString(),
      metadata: { seed: true }
    });

    const e1 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId,
      source: 'test-suite',
      payload: mkEnvelope()
    });

    const e2 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId,
      source: 'test-suite',
      payload: mkEnvelope()
    });

    await db.markOutboundEventDeadLetter(e1, 'seed-ops-1');
    await db.markOutboundEventDeadLetter(e2, 'seed-ops-2');

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const policyRes = await fetch(`${base}/jobs/dead-letter/replay-policy`, {
        headers: {
          'x-operator-id': 'ops-admin'
        }
      });
      assert(policyRes.status === 200, `policy endpoint expected 200, got ${policyRes.status}`);
      const policy = await policyRes.json();
      assert(policy.ok === true, 'policy endpoint should return ok=true');
      assert(policy.policy.approverPolicyEnforced === true, 'approver policy should be enforced when allowlist/roles configured');
      assert(policy.operator.authorized === true, 'allowlisted operator should be authorized');

      // blocked: approval code provided + approve flag set, but operator not authorized
      const blockedRes = await fetch(`${base}/jobs/dead-letter/replay-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventType: 'scheduled_intervention.monitor',
          userId,
          limit: 10,
          maxRetries: 0,
          approve: true,
          approvalCode,
          operatorId: 'unknown-operator',
          operatorRole: 'guest'
        })
      });

      assert(blockedRes.status === 403, `expected 403 for unauthorized operator, got ${blockedRes.status}`);
      const blocked = await blockedRes.json();
      assert(blocked.reason === 'operator_not_authorized', `expected operator_not_authorized, got ${blocked.reason}`);
      assert(Array.isArray(blocked.blockers) && blocked.blockers.includes('operator_not_authorized'), 'expected operator_not_authorized blocker');

      const rowBlocked = await db.getOutboundEventById(e1);
      assert(rowBlocked.status === 'dead_letter', `event should stay dead_letter when blocked, got ${rowBlocked.status}`);

      // success: role-authorized operator (strategy=either)
      const okRes = await fetch(`${base}/jobs/dead-letter/replay-bulk`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-operator-role': 'sre'
        },
        body: JSON.stringify({
          eventType: 'scheduled_intervention.monitor',
          userId,
          limit: 10,
          maxRetries: 0,
          approve: true,
          approvalCode
        })
      });

      assert(okRes.status === 200, `expected 200 for authorized role replay, got ${okRes.status}`);
      const okBody = await okRes.json();
      assert(okBody.ok === true, 'authorized replay should return ok=true');
      assert(okBody.policy_applied?.operator?.authorized === true, 'policy_applied.operator.authorized should be true');
      assert(okBody.result.dispatched >= 2, `expected dispatched >=2, got ${okBody.result.dispatched}`);

      const row1 = await db.getOutboundEventById(e1);
      const row2 = await db.getOutboundEventById(e2);
      assert(row1.status === 'dispatched', `e1 should be dispatched, got ${row1.status}`);
      assert(row2.status === 'dispatched', `e2 should be dispatched, got ${row2.status}`);

      console.log('✅ dead-letter ops policy test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await db.redis.del(queueKey).catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ dead-letter ops policy test failed:', err.message);
  process.exit(1);
});
