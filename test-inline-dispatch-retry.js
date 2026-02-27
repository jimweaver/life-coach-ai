#!/usr/bin/env node

const SchedulerRunner = require('./core/scheduler-runner');
const CronEventDelivery = require('./core/cron-event-delivery');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  let dispatchedCalls = 0;
  let failedCalls = 0;
  let deliverWithRetryCalls = 0;
  let deliverCalls = 0;

  const mockDb = {
    enqueueOutboundEvent: async () => 'evt-inline-1',
    markOutboundEventDispatched: async (_id, _meta) => { dispatchedCalls += 1; },
    markOutboundEventFailed: async () => { failedCalls += 1; },
    logAgentAction: async () => {}
  };

  const delivery = new CronEventDelivery({ mode: 'redis', retryMax: 5 });

  delivery.deliver = async () => {
    deliverCalls += 1;
    return { delivered: false, mode: 'redis', reason: 'should-not-be-used' };
  };

  delivery.deliverWithRetry = async (_envelope, opts = {}) => {
    deliverWithRetryCalls += 1;
    assert(opts.maxRetries === 2, `expected inline maxRetries=2, got ${opts.maxRetries}`);
    return {
      delivered: true,
      mode: 'redis',
      attempts: 3,
      retried: true,
      target: 'mock-queue'
    };
  };

  const runner = new SchedulerRunner(mockDb, {
    delivery,
    inlineRetryMax: 2
  });

  const out = await runner.dispatchIntervention({
    userId: null,
    cycle: 'monitor',
    message: 'inline retry probe',
    severity: 'warning',
    metadata: { test: true }
  });

  assert(deliverWithRetryCalls === 1, 'expected dispatchIntervention to call deliverWithRetry once');
  assert(deliverCalls === 0, 'dispatchIntervention should not use one-shot deliver when deliverWithRetry exists');
  assert(out.deliveryResult?.delivered === true, 'expected successful delivery');
  assert(out.deliveryResult?.attempts === 3, 'expected attempts from deliverWithRetry result');
  assert(out.outbox?.status === 'dispatched', `expected outbox status dispatched, got ${out.outbox?.status}`);
  assert(dispatchedCalls === 1, 'expected one markOutboundEventDispatched call');
  assert(failedCalls === 0, 'did not expect markOutboundEventFailed call');

  console.log('✅ inline dispatch retry test passed');
}

run().catch((err) => {
  console.error('❌ inline dispatch retry test failed:', err.message);
  process.exit(1);
});
