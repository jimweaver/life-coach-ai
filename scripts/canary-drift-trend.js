const CanaryDriftDetector = require('../core/canary-drift-detector');
const { computeSuggestedThresholds } = require('./canary-check');

function rankLevel(level) {
  const rank = { info: 1, warn: 2, warning: 2, critical: 3 };
  return rank[String(level || 'info').toLowerCase()] || 1;
}

function normalizeIso(ts) {
  if (!ts) return null;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function createEmptyBucket(startMs, bucketMinutes) {
  return {
    bucket_start: new Date(startMs).toISOString(),
    bucket_end: new Date(startMs + bucketMinutes * 60_000).toISOString(),
    total: 0,
    ready: 0,
    drift_detected: 0,
    levels: {
      info: 0,
      warn: 0,
      critical: 0
    },
    drift_rate: 0,
    critical_rate: 0,
    last_level: 'info',
    last_reasons: []
  };
}

function computeCanaryDriftTrend({
  history = [],
  activeThresholds,
  sinceMinutes = 1440,
  bucketMinutes = 60,
  minSamples = Number(process.env.CANARY_PROFILE_MIN_SAMPLES || 5),
  warnRatio = Number(process.env.CANARY_DRIFT_WARN_RATIO || 0.25),
  criticalRatio = Number(process.env.CANARY_DRIFT_CRITICAL_RATIO || 0.5),
  historyFile = null
} = {}) {
  const normalizedSince = clampInt(sinceMinutes, 1, 10080, 1440);
  const normalizedBucket = clampInt(bucketMinutes, 1, 1440, 60);
  const normalizedMinSamples = clampInt(minSamples, 1, 100000, 5);

  const now = Date.now();
  const cutoffMs = now - (normalizedSince * 60_000);

  const parsed = history
    .map((h) => ({
      ...h,
      ts_ms: Date.parse(h?.ts || h?.timestamp || '')
    }))
    .filter((h) => Number.isFinite(h.ts_ms))
    .sort((a, b) => a.ts_ms - b.ts_ms);

  const considered = parsed.filter((h) => h.ts_ms >= cutoffMs);

  const driftDetector = new CanaryDriftDetector({
    warnRatio,
    criticalRatio,
    minSamples: normalizedMinSamples
  });

  const bucketSizeMs = normalizedBucket * 60_000;
  const buckets = new Map();

  let rolling = [];
  let peakLevel = 'info';
  let lastLevel = 'info';

  for (const entry of parsed) {
    rolling.push(entry);

    if (entry.ts_ms < cutoffMs) continue;

    const profile = computeSuggestedThresholds(rolling, {
      minSamples: normalizedMinSamples
    });

    const drift = driftDetector.evaluate({
      profile,
      activeThresholds,
      historyCount: rolling.length,
      historyFile
    });

    const bucketStartMs = Math.floor(entry.ts_ms / bucketSizeMs) * bucketSizeMs;
    if (!buckets.has(bucketStartMs)) {
      buckets.set(bucketStartMs, createEmptyBucket(bucketStartMs, normalizedBucket));
    }

    const bucket = buckets.get(bucketStartMs);
    bucket.total += 1;
    if (drift.ready) bucket.ready += 1;

    const level = String(drift.level || 'info').toLowerCase();
    if (level === 'critical') bucket.levels.critical += 1;
    else if (level === 'warn' || level === 'warning') bucket.levels.warn += 1;
    else bucket.levels.info += 1;

    if (drift.drift_detected) {
      bucket.drift_detected += 1;
    }

    bucket.last_level = level;
    bucket.last_reasons = Array.isArray(drift.reasons) ? drift.reasons.slice(0, 3) : [];

    if (rankLevel(level) > rankLevel(peakLevel)) peakLevel = level;
    lastLevel = level;
  }

  const bucketList = [...buckets.values()]
    .sort((a, b) => Date.parse(a.bucket_start) - Date.parse(b.bucket_start))
    .map((b) => ({
      ...b,
      drift_rate: b.total > 0 ? Number((b.drift_detected / b.total).toFixed(4)) : 0,
      critical_rate: b.total > 0 ? Number((b.levels.critical / b.total).toFixed(4)) : 0
    }));

  const summary = {
    window_minutes: normalizedSince,
    bucket_minutes: normalizedBucket,
    history_entries_total: parsed.length,
    history_entries_considered: considered.length,
    buckets: bucketList.length,
    peak_level: peakLevel,
    last_level: lastLevel,
    total_ready: bucketList.reduce((sum, b) => sum + b.ready, 0),
    total_drift_detected: bucketList.reduce((sum, b) => sum + b.drift_detected, 0),
    total_warn: bucketList.reduce((sum, b) => sum + b.levels.warn, 0),
    total_critical: bucketList.reduce((sum, b) => sum + b.levels.critical, 0),
    first_bucket_at: bucketList[0]?.bucket_start || null,
    last_bucket_at: bucketList[bucketList.length - 1]?.bucket_start || null
  };

  return {
    config: {
      min_samples: normalizedMinSamples,
      warn_ratio: warnRatio,
      critical_ratio: criticalRatio,
      active_thresholds: {
        max_error_rate: Number(activeThresholds?.max_error_rate ?? NaN),
        max_p95_ms: Number(activeThresholds?.max_p95_ms ?? NaN),
        max_avg_ms: Number(activeThresholds?.max_avg_ms ?? NaN)
      }
    },
    summary,
    buckets: bucketList,
    generated_at: normalizeIso(new Date().toISOString())
  };
}

module.exports = {
  computeCanaryDriftTrend
};
