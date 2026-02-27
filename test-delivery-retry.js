/**
 * test-delivery-retry.js
 * Tests for delivery retry/backoff + dead-letter handling.
 */

const assert = require('assert');
const CronEventDelivery = require('./core/cron-event-delivery');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        passed++;
        console.log(`  ✅ ${name}`);
      }).catch((err) => {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
      });
    }
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

async function run() {
  console.log('\n🔄 Delivery Retry/Backoff + Dead-Letter Tests\n');

  // ── CronEventDelivery: calcBackoffMs ──

  await test('calcBackoffMs — attempt 0 returns <= baseDelay', () => {
    const d = new CronEventDelivery({ retryBaseDelayMs: 1000, retryMaxDelayMs: 60000, retryJitter: false });
    const delay = d.calcBackoffMs(0);
    assert.strictEqual(delay, 1000, `expected 1000, got ${delay}`);
  });

  await test('calcBackoffMs — attempt 2 returns 4x base (no jitter)', () => {
    const d = new CronEventDelivery({ retryBaseDelayMs: 1000, retryMaxDelayMs: 60000, retryJitter: false });
    const delay = d.calcBackoffMs(2);
    assert.strictEqual(delay, 4000, `expected 4000, got ${delay}`);
  });

  await test('calcBackoffMs — caps at maxDelay', () => {
    const d = new CronEventDelivery({ retryBaseDelayMs: 1000, retryMaxDelayMs: 5000, retryJitter: false });
    const delay = d.calcBackoffMs(10);
    assert.strictEqual(delay, 5000, `expected 5000, got ${delay}`);
  });

  await test('calcBackoffMs — with jitter stays <= exponential', () => {
    const d = new CronEventDelivery({ retryBaseDelayMs: 1000, retryMaxDelayMs: 60000, retryJitter: true });
    for (let i = 0; i < 20; i++) {
      const delay = d.calcBackoffMs(3);
      const expMax = 1000 * Math.pow(2, 3); // 8000
      assert.ok(delay >= 0 && delay <= expMax, `jitter delay ${delay} out of range [0, ${expMax}]`);
    }
  });

  // ── deliverWithRetry: success on first attempt ──

  await test('deliverWithRetry — succeeds immediately (no retry needed)', async () => {
    let deliverCalls = 0;
    const d = new CronEventDelivery({ mode: 'redis', retryMax: 3 });
    d.redis = {
      rpush: async () => { deliverCalls++; return 1; }
    };
    d.deliver = async () => {
      deliverCalls++;
      return { delivered: true, mode: 'redis' };
    };

    const result = await d.deliverWithRetry({ kind: 'test' });
    assert.strictEqual(result.delivered, true);
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(result.retried, false);
  });

  // ── deliverWithRetry: fails then succeeds ──

  await test('deliverWithRetry — fails twice then succeeds on 3rd attempt', async () => {
    let attempt = 0;
    const d = new CronEventDelivery({ mode: 'webhook', retryMax: 5, retryBaseDelayMs: 10 });
    d.deliver = async () => {
      attempt++;
      if (attempt < 3) return { delivered: false, mode: 'webhook', reason: 'http_503' };
      return { delivered: true, mode: 'webhook', status: 200 };
    };

    const sleepCalls = [];
    const result = await d.deliverWithRetry({ kind: 'test' }, {
      sleep: async (ms) => { sleepCalls.push(ms); }
    });

    assert.strictEqual(result.delivered, true);
    assert.strictEqual(result.attempts, 3);
    assert.strictEqual(result.retried, true);
    assert.strictEqual(sleepCalls.length, 2);
  });

  // ── deliverWithRetry: exhausted ──

  await test('deliverWithRetry — exhausts all retries and returns exhausted=true', async () => {
    const d = new CronEventDelivery({ mode: 'webhook', retryMax: 2, retryBaseDelayMs: 10 });
    d.deliver = async () => ({ delivered: false, mode: 'webhook', reason: 'http_500' });

    const result = await d.deliverWithRetry({ kind: 'test' }, {
      sleep: async () => {}
    });

    assert.strictEqual(result.delivered, false);
    assert.strictEqual(result.attempts, 3); // initial + 2 retries
    assert.strictEqual(result.exhausted, true);
    assert.strictEqual(result.retried, true);
  });

  // ── deliverWithRetry: handles thrown errors as failures ──

  await test('deliverWithRetry — treats thrown errors as failed attempts', async () => {
    let attempt = 0;
    const d = new CronEventDelivery({ mode: 'webhook', retryMax: 1, retryBaseDelayMs: 5 });
    d.deliver = async () => {
      attempt++;
      if (attempt === 1) throw new Error('ECONNREFUSED');
      return { delivered: true, mode: 'webhook' };
    };

    const result = await d.deliverWithRetry({ kind: 'test' }, {
      sleep: async () => {}
    });

    assert.strictEqual(result.delivered, true);
    assert.strictEqual(result.attempts, 2);
  });

  // ── deliverWithRetry: maxRetries=0 means no retries ──

  await test('deliverWithRetry — maxRetries=0 does not retry', async () => {
    const d = new CronEventDelivery({ mode: 'webhook', retryMax: 3 });
    d.deliver = async () => ({ delivered: false, mode: 'webhook', reason: 'fail' });

    const result = await d.deliverWithRetry({ kind: 'test' }, {
      maxRetries: 0,
      sleep: async () => { throw new Error('should not sleep'); }
    });

    assert.strictEqual(result.delivered, false);
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(result.retried, false);
  });

  // ── SchedulerRunner.runRetryCycle mock tests ──

  const SchedulerRunner = require('./core/scheduler-runner');

  await test('runRetryCycle — returns not_supported when DB lacks outbox methods', async () => {
    const mockDb = {
      redis: null,
      listUserIds: async () => [],
      getLatestKbiSnapshot: async () => ({}),
      getUserProfile: async () => null,
      logAgentAction: async () => {}
    };
    const runner = new SchedulerRunner(mockDb);
    const result = await runner.runRetryCycle();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'outbox_retry_not_supported');
  });

  await test('runRetryCycle — delivers, schedules retry, and dead-letters appropriately', async () => {
    // Three events: one will succeed, one still retryable, one exhausted
    const events = [
      { event_id: 'evt-1', payload: { text: 'ok-event' }, retry_count: 0, max_retries: 3 },
      { event_id: 'evt-2', payload: { text: 'fail-event' }, retry_count: 1, max_retries: 3 },
      { event_id: 'evt-3', payload: { text: 'exhaust-event' }, retry_count: 2, max_retries: 3 }
    ];

    const dispatched = [];
    const retryIncremented = [];
    const deadLettered = [];

    const mockDb = {
      redis: null,
      enqueueOutboundEvent: async () => 'x',
      markOutboundEventDispatched: async (id, meta) => { dispatched.push({ id, meta }); },
      markOutboundEventFailed: async () => {},
      markOutboundEventDeadLetter: async (id, msg, meta) => { deadLettered.push({ id, msg, meta }); },
      getRetryableEvents: async () => events,
      incrementRetryCount: async (id, nextAt) => { retryIncremented.push({ id, nextAt }); },
      getDeadLetterEvents: async () => [],
      listUserIds: async () => [],
      getLatestKbiSnapshot: async () => ({}),
      getUserProfile: async () => null,
      logAgentAction: async () => {}
    };

    let deliverCallIndex = 0;
    const deliverResults = [
      { delivered: true, mode: 'redis' },   // evt-1 succeeds
      { delivered: false, mode: 'redis', reason: 'redis unavailable' }, // evt-2 fails
      { delivered: false, mode: 'redis', reason: 'redis unavailable' }  // evt-3 fails (exhausted)
    ];

    const mockDelivery = new CronEventDelivery({ mode: 'redis', retryMax: 3, retryBaseDelayMs: 10, retryJitter: false });
    mockDelivery.deliver = async () => deliverResults[deliverCallIndex++];

    const runner = new SchedulerRunner(mockDb, { delivery: mockDelivery });

    const result = await runner.runRetryCycle({ limit: 10 });

    assert.strictEqual(result.found, 3);
    assert.strictEqual(result.retried, 3);
    assert.strictEqual(result.delivered, 1);
    assert.strictEqual(result.failed, 1);     // evt-2 still retryable
    assert.strictEqual(result.dead_lettered, 1); // evt-3 exhausted

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0].id, 'evt-1');

    assert.strictEqual(deadLettered.length, 1);
    assert.strictEqual(deadLettered[0].id, 'evt-3');

    // evt-2 should have retry scheduled
    assert.strictEqual(retryIncremented.length, 2); // evt-2 (retry) + evt-3 (before dead-letter)

    // Check result detail
    const r1 = result.results.find(r => r.event_id === 'evt-1');
    assert.strictEqual(r1.status, 'dispatched');

    const r2 = result.results.find(r => r.event_id === 'evt-2');
    assert.strictEqual(r2.status, 'retry_scheduled');
    assert.ok(r2.next_retry_at, 'should have next_retry_at');

    const r3 = result.results.find(r => r.event_id === 'evt-3');
    assert.strictEqual(r3.status, 'dead_letter');
  });

  await test('runRetryCycle — handles empty retryable queue gracefully', async () => {
    const mockDb = {
      redis: null,
      enqueueOutboundEvent: async () => 'x',
      markOutboundEventDispatched: async () => {},
      markOutboundEventFailed: async () => {},
      markOutboundEventDeadLetter: async () => {},
      getRetryableEvents: async () => [],
      incrementRetryCount: async () => {},
      getDeadLetterEvents: async () => [],
      listUserIds: async () => [],
      getLatestKbiSnapshot: async () => ({}),
      getUserProfile: async () => null,
      logAgentAction: async () => {}
    };

    const runner = new SchedulerRunner(mockDb);
    const result = await runner.runRetryCycle();

    assert.strictEqual(result.found, 0);
    assert.strictEqual(result.retried, 0);
    assert.strictEqual(result.delivered, 0);
    assert.strictEqual(result.dead_lettered, 0);
  });

  // ── Summary ──

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
