#!/usr/bin/env node

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  appendHistory,
  loadHistory,
  parseHistoryLines,
  computeSuggestedThresholds
} = require('./scripts/canary-check');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const synthetic = [];
  for (let i = 0; i < 10; i += 1) {
    synthetic.push({
      metrics: {
        error_rate: i % 5 === 0 ? 0.1 : 0,
        p95_ms: 1000 + i * 120,
        avg_ms: 700 + i * 80
      }
    });
  }

  const profile = computeSuggestedThresholds(synthetic, {
    minSamples: 5,
    errorHeadroom: 0.02,
    latencyMultiplier: 1.2
  });

  assert(profile.ready === true, 'expected profile.ready=true');
  assert(profile.sample_count === 10, `expected sample_count=10, got ${profile.sample_count}`);
  assert(profile.suggested_thresholds.max_p95_ms >= profile.observed.p95_latency_p95,
    'max_p95_ms should be >= observed p95 baseline');
  assert(profile.suggested_thresholds.max_avg_ms >= profile.observed.avg_latency_p95,
    'max_avg_ms should be >= observed avg baseline');

  const insufficient = computeSuggestedThresholds(synthetic.slice(0, 2), {
    minSamples: 5
  });
  assert(insufficient.ready === false, 'expected insufficient profile.ready=false');
  assert(insufficient.reason === 'insufficient_samples', `unexpected reason ${insufficient.reason}`);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canary-profile-test-'));
  const file = path.join(dir, 'history.jsonl');

  try {
    await appendHistory(file, {
      ok: true,
      rollback_recommended: false,
      metrics: { error_rate: 0, p95_ms: 1100, avg_ms: 800 },
      thresholds: { max_error_rate: 0.2, max_p95_ms: 3500, max_avg_ms: 2200 },
      request_count: 3
    });

    await appendHistory(file, {
      ok: true,
      rollback_recommended: false,
      metrics: { error_rate: 0.1, p95_ms: 1300, avg_ms: 900 },
      thresholds: { max_error_rate: 0.2, max_p95_ms: 3500, max_avg_ms: 2200 },
      request_count: 3
    });

    const loaded = await loadHistory(file);
    assert(loaded.length === 2, `expected loaded length 2, got ${loaded.length}`);

    const raw = await fs.readFile(file, 'utf8');
    const parsed = parseHistoryLines(raw);
    assert(parsed.length === 2, `expected parsed length 2, got ${parsed.length}`);

    console.log('✅ canary profile test passed');
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((err) => {
  console.error('❌ canary profile test failed:', err.message);
  process.exit(1);
});
