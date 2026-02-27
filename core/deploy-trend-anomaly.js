function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function percentile(values = [], p = 50) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function parseMs(ts) {
  const n = Date.parse(ts || '');
  return Number.isFinite(n) ? n : null;
}

function rankLevel(level) {
  const rank = { info: 1, warn: 2, critical: 3 };
  return rank[String(level || 'info').toLowerCase()] || 1;
}

class DeployTrendAnomalyDetector {
  constructor(options = {}) {
    this.warnErrorRate = Number(options.warnErrorRate ?? process.env.DEPLOY_TREND_ANOMALY_WARN_ERROR_RATE ?? 0.25);
    this.criticalErrorRate = Number(options.criticalErrorRate ?? process.env.DEPLOY_TREND_ANOMALY_CRITICAL_ERROR_RATE ?? 0.5);

    this.warnAbortRatio = Number(options.warnAbortRatio ?? process.env.DEPLOY_TREND_ANOMALY_WARN_ABORT_RATIO ?? 0.15);
    this.criticalAbortRatio = Number(options.criticalAbortRatio ?? process.env.DEPLOY_TREND_ANOMALY_CRITICAL_ABORT_RATIO ?? 0.3);

    this.warnVolumeSpikeMultiplier = Number(options.warnVolumeSpikeMultiplier ?? process.env.DEPLOY_TREND_ANOMALY_WARN_VOLUME_SPIKE ?? 2.5);
    this.criticalVolumeSpikeMultiplier = Number(options.criticalVolumeSpikeMultiplier ?? process.env.DEPLOY_TREND_ANOMALY_CRITICAL_VOLUME_SPIKE ?? 4.0);

    this.warnDurationMultiplier = Number(options.warnDurationMultiplier ?? process.env.DEPLOY_TREND_ANOMALY_WARN_DURATION_SPIKE ?? 1.8);
    this.criticalDurationMultiplier = Number(options.criticalDurationMultiplier ?? process.env.DEPLOY_TREND_ANOMALY_CRITICAL_DURATION_SPIKE ?? 2.5);

    this.minRunsForDuration = Number(options.minRunsForDuration ?? process.env.DEPLOY_TREND_ANOMALY_MIN_RUNS_DURATION ?? 3);
    this.minBucketsForVolume = Number(options.minBucketsForVolume ?? process.env.DEPLOY_TREND_ANOMALY_MIN_BUCKETS_VOLUME ?? 3);
    this.minBucketEvents = Number(options.minBucketEvents ?? process.env.DEPLOY_TREND_ANOMALY_MIN_BUCKET_EVENTS ?? 10);
  }

  normalizeRuns(runs = []) {
    return runs.map((r) => {
      const total = Math.max(0, toNum(r.total_events));
      const errors = Math.max(0, toNum(r.error_events));
      const warns = Math.max(0, toNum(r.warn_events));
      const infos = Math.max(0, toNum(r.info_events));
      const debugs = Math.max(0, toNum(r.debug_events));

      const firstMs = parseMs(r.first_event_at);
      const lastMs = parseMs(r.last_event_at);
      const durationMs = firstMs !== null && lastMs !== null
        ? Math.max(0, lastMs - firstMs)
        : 0;

      return {
        run_id: r.run_id || null,
        source: r.source || null,
        total_events: total,
        error_events: errors,
        warn_events: warns,
        info_events: infos,
        debug_events: debugs,
        error_rate: total > 0 ? Number((errors / total).toFixed(4)) : 0,
        warn_rate: total > 0 ? Number((warns / total).toFixed(4)) : 0,
        duration_ms: durationMs,
        first_event_at: r.first_event_at || null,
        last_event_at: r.last_event_at || null
      };
    });
  }

  detectRunErrorRateAnomalies(runs, anomalies) {
    for (const run of runs) {
      if (run.total_events <= 0) continue;

      if (run.error_rate >= this.criticalErrorRate) {
        anomalies.push({
          level: 'critical',
          type: 'run_error_rate',
          message: `run ${run.run_id || 'unknown'} error_rate ${run.error_rate} >= ${this.criticalErrorRate}`,
          context: {
            run_id: run.run_id,
            source: run.source,
            error_rate: run.error_rate,
            total_events: run.total_events,
            error_events: run.error_events
          }
        });
      } else if (run.error_rate >= this.warnErrorRate) {
        anomalies.push({
          level: 'warn',
          type: 'run_error_rate',
          message: `run ${run.run_id || 'unknown'} error_rate ${run.error_rate} >= ${this.warnErrorRate}`,
          context: {
            run_id: run.run_id,
            source: run.source,
            error_rate: run.error_rate,
            total_events: run.total_events,
            error_events: run.error_events
          }
        });
      }
    }
  }

  detectDurationRegression(runs, anomalies) {
    const candidates = runs
      .filter((r) => r.duration_ms > 0)
      .sort((a, b) => parseMs(b.last_event_at) - parseMs(a.last_event_at));

    if (candidates.length < this.minRunsForDuration) return;

    const latest = candidates[0];
    const baseline = candidates.slice(1).map((r) => r.duration_ms);

    if (!baseline.length) return;

    const baselineP50 = percentile(baseline, 50);
    if (baselineP50 <= 0) return;

    const ratio = Number((latest.duration_ms / baselineP50).toFixed(4));

    if (ratio >= this.criticalDurationMultiplier) {
      anomalies.push({
        level: 'critical',
        type: 'run_duration_regression',
        message: `run duration ratio ${ratio} >= ${this.criticalDurationMultiplier}`,
        context: {
          run_id: latest.run_id,
          source: latest.source,
          latest_duration_ms: latest.duration_ms,
          baseline_p50_ms: baselineP50,
          ratio
        }
      });
    } else if (ratio >= this.warnDurationMultiplier) {
      anomalies.push({
        level: 'warn',
        type: 'run_duration_regression',
        message: `run duration ratio ${ratio} >= ${this.warnDurationMultiplier}`,
        context: {
          run_id: latest.run_id,
          source: latest.source,
          latest_duration_ms: latest.duration_ms,
          baseline_p50_ms: baselineP50,
          ratio
        }
      });
    }
  }

  detectVolumeSpike(timeline = [], anomalies) {
    const normalized = timeline
      .map((t) => ({
        bucket_start: t.bucket_start,
        total_events: Math.max(0, toNum(t.total_events)),
        error_events: Math.max(0, toNum(t.error_events)),
        warn_events: Math.max(0, toNum(t.warn_events))
      }))
      .sort((a, b) => parseMs(a.bucket_start) - parseMs(b.bucket_start));

    if (normalized.length < this.minBucketsForVolume) return;

    const latest = normalized[normalized.length - 1];
    const baseline = normalized.slice(0, -1).map((b) => b.total_events);

    if (!baseline.length) return;

    const baselineP50 = percentile(baseline, 50);
    if (baselineP50 <= 0) return;

    if (latest.total_events < this.minBucketEvents) return;

    const ratio = Number((latest.total_events / baselineP50).toFixed(4));

    if (ratio >= this.criticalVolumeSpikeMultiplier) {
      anomalies.push({
        level: 'critical',
        type: 'volume_spike',
        message: `bucket volume ratio ${ratio} >= ${this.criticalVolumeSpikeMultiplier}`,
        context: {
          bucket_start: latest.bucket_start,
          latest_total_events: latest.total_events,
          baseline_p50_events: baselineP50,
          ratio
        }
      });
    } else if (ratio >= this.warnVolumeSpikeMultiplier) {
      anomalies.push({
        level: 'warn',
        type: 'volume_spike',
        message: `bucket volume ratio ${ratio} >= ${this.warnVolumeSpikeMultiplier}`,
        context: {
          bucket_start: latest.bucket_start,
          latest_total_events: latest.total_events,
          baseline_p50_events: baselineP50,
          ratio
        }
      });
    }
  }

  detectAbortRatio(heatmapRows = [], anomalies) {
    const abortRow = heatmapRows.find((r) => r.event === 'wrapper.abort');
    const completeRow = heatmapRows.find((r) => r.event === 'wrapper.complete');

    const abortCount = toNum(abortRow?.total_count || 0);
    const completeCount = toNum(completeRow?.total_count || 0);
    const denominator = abortCount + completeCount;

    if (denominator <= 0) return;

    const ratio = Number((abortCount / denominator).toFixed(4));

    if (ratio >= this.criticalAbortRatio) {
      anomalies.push({
        level: 'critical',
        type: 'abort_ratio',
        message: `abort ratio ${ratio} >= ${this.criticalAbortRatio}`,
        context: {
          abort_count: abortCount,
          complete_count: completeCount,
          ratio
        }
      });
    } else if (ratio >= this.warnAbortRatio) {
      anomalies.push({
        level: 'warn',
        type: 'abort_ratio',
        message: `abort ratio ${ratio} >= ${this.warnAbortRatio}`,
        context: {
          abort_count: abortCount,
          complete_count: completeCount,
          ratio
        }
      });
    }
  }

  evaluate({ runs = [], timeline = [], heatmapRows = [] } = {}) {
    const normalizedRuns = this.normalizeRuns(runs);
    const anomalies = [];

    this.detectRunErrorRateAnomalies(normalizedRuns, anomalies);
    this.detectDurationRegression(normalizedRuns, anomalies);
    this.detectVolumeSpike(timeline, anomalies);
    this.detectAbortRatio(heatmapRows, anomalies);

    let level = 'info';
    for (const anomaly of anomalies) {
      if (rankLevel(anomaly.level) > rankLevel(level)) {
        level = anomaly.level;
      }
    }

    const reasons = anomalies.map((a) => a.type);

    return {
      level,
      anomaly_detected: anomalies.length > 0,
      anomaly_count: anomalies.length,
      reasons,
      anomalies,
      metrics: {
        run_count: normalizedRuns.length,
        timeline_points: Array.isArray(timeline) ? timeline.length : 0,
        heatmap_rows: Array.isArray(heatmapRows) ? heatmapRows.length : 0
      },
      thresholds: {
        warn_error_rate: this.warnErrorRate,
        critical_error_rate: this.criticalErrorRate,
        warn_abort_ratio: this.warnAbortRatio,
        critical_abort_ratio: this.criticalAbortRatio,
        warn_volume_spike: this.warnVolumeSpikeMultiplier,
        critical_volume_spike: this.criticalVolumeSpikeMultiplier,
        warn_duration_spike: this.warnDurationMultiplier,
        critical_duration_spike: this.criticalDurationMultiplier
      }
    };
  }
}

module.exports = DeployTrendAnomalyDetector;
