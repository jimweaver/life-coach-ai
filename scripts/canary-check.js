#!/usr/bin/env node

const { v4: uuidv4 } = require('uuid');

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
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

async function runSingleTransaction(baseUrl, timeoutMs) {
  const userId = uuidv4();
  const started = Date.now();

  // Step 1: profile bootstrap
  const profileRes = await fetchWithTimeout(`${baseUrl}/profile/${userId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `canary-${userId.slice(0, 8)}`,
      created_at: new Date().toISOString()
    })
  }, timeoutMs);

  if (profileRes.status !== 200) {
    throw new Error(`profile_status_${profileRes.status}`);
  }

  // Step 2: goal write path
  const goalRes = await fetchWithTimeout(`${baseUrl}/goals/${userId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'canary goal',
      domain: 'career'
    })
  }, timeoutMs);

  if (goalRes.status !== 200) {
    throw new Error(`goal_status_${goalRes.status}`);
  }

  // Step 3: chat orchestration path
  const chatRes = await fetchWithTimeout(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      message: 'canary validation run'
    })
  }, timeoutMs);

  if (chatRes.status !== 200) {
    throw new Error(`chat_status_${chatRes.status}`);
  }

  return {
    ok: true,
    duration_ms: Date.now() - started,
    user_id: userId
  };
}

async function runCanary(options = {}) {
  const baseUrl = options.baseUrl || process.env.CANARY_BASE_URL || process.env.SMOKE_CHECK_BASE_URL || 'http://localhost:8787';
  const requestCount = Number(options.requestCount ?? process.env.CANARY_REQUEST_COUNT ?? 3);
  const timeoutMs = Number(options.timeoutMs ?? process.env.CANARY_REQUEST_TIMEOUT_MS ?? 10000);

  const maxErrorRate = Number(options.maxErrorRate ?? process.env.CANARY_MAX_ERROR_RATE ?? 0.2);
  const maxP95Ms = Number(options.maxP95Ms ?? process.env.CANARY_P95_MAX_MS ?? 3500);
  const maxAvgMs = Number(options.maxAvgMs ?? process.env.CANARY_AVG_MAX_MS ?? 2200);

  const report = {
    ok: false,
    base_url: baseUrl,
    request_count: requestCount,
    thresholds: {
      max_error_rate: maxErrorRate,
      max_p95_ms: maxP95Ms,
      max_avg_ms: maxAvgMs
    },
    metrics: {
      total: requestCount,
      success: 0,
      failed: 0,
      error_rate: 0,
      avg_ms: 0,
      p95_ms: 0
    },
    rollback_recommended: false,
    rollback_reasons: [],
    samples: []
  };

  const durations = [];

  for (let i = 0; i < requestCount; i += 1) {
    try {
      const tx = await runSingleTransaction(baseUrl, timeoutMs);
      report.metrics.success += 1;
      durations.push(tx.duration_ms);
      report.samples.push({
        index: i + 1,
        ok: true,
        duration_ms: tx.duration_ms
      });
    } catch (err) {
      report.metrics.failed += 1;
      report.samples.push({
        index: i + 1,
        ok: false,
        error: err.message
      });
    }
  }

  report.metrics.error_rate = requestCount > 0
    ? Number((report.metrics.failed / requestCount).toFixed(4))
    : 1;

  report.metrics.avg_ms = durations.length
    ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2))
    : 0;

  report.metrics.p95_ms = durations.length
    ? Number(percentile(durations, 95).toFixed(2))
    : 0;

  if (report.metrics.error_rate > maxErrorRate) {
    report.rollback_reasons.push(`error_rate ${report.metrics.error_rate} > ${maxErrorRate}`);
  }

  if (durations.length > 0 && report.metrics.p95_ms > maxP95Ms) {
    report.rollback_reasons.push(`p95_ms ${report.metrics.p95_ms} > ${maxP95Ms}`);
  }

  if (durations.length > 0 && report.metrics.avg_ms > maxAvgMs) {
    report.rollback_reasons.push(`avg_ms ${report.metrics.avg_ms} > ${maxAvgMs}`);
  }

  report.rollback_recommended = report.rollback_reasons.length > 0;
  report.ok = !report.rollback_recommended;

  return report;
}

async function main() {
  const report = await runCanary();
  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, fatal: err.message }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  runCanary
};
