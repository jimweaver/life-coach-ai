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

function rankLevel(level) {
  const rank = { info: 1, warn: 2, warning: 2, critical: 3 };
  return rank[String(level || 'info').toLowerCase()] || 1;
}

class DeployTrendTelemetrySuppressionAlertSuppressionAlertDetector {
  constructor(options = {}) {
    this.warnCooldownShare = Number(options.warnCooldownShare ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_WARN_COOLDOWN_SHARE ?? 0.6);
    this.criticalCooldownShare = Number(options.criticalCooldownShare ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_CRITICAL_COOLDOWN_SHARE ?? 0.85);

    this.warnDuplicateWindowShare = Number(options.warnDuplicateWindowShare ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_WARN_DUPLICATE_SHARE ?? 0.6);
    this.criticalDuplicateWindowShare = Number(options.criticalDuplicateWindowShare ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_CRITICAL_DUPLICATE_SHARE ?? 0.85);

    this.warnCooldownSpike = Number(options.warnCooldownSpike ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_WARN_COOLDOWN_SPIKE ?? 1.4);
    this.criticalCooldownSpike = Number(options.criticalCooldownSpike ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_CRITICAL_COOLDOWN_SPIKE ?? 1.8);

    this.warnDuplicateWindowSpike = Number(options.warnDuplicateWindowSpike ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_WARN_DUPLICATE_SPIKE ?? 1.4);
    this.criticalDuplicateWindowSpike = Number(options.criticalDuplicateWindowSpike ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_CRITICAL_DUPLICATE_SPIKE ?? 1.8);

    this.minSuppressed = Number(options.minSuppressed ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_MIN_SUPPRESSED ?? 2);
    this.minBuckets = Number(options.minBuckets ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_MIN_BUCKETS ?? 1);
    this.baselineBuckets = Number(options.baselineBuckets ?? process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_BASELINE_BUCKETS ?? 3);
  }

  normalizeBuckets(buckets = []) {
    return (Array.isArray(buckets) ? buckets : [])
      .map((bucket) => {
        const routeSuppressedTotal = Math.max(0, toNum(bucket.route_suppressed_total));
        const routeSuppressedCooldown = Math.max(0, toNum(bucket.route_suppressed_cooldown));
        const routeSuppressedDuplicateWindow = Math.max(0, toNum(bucket.route_suppressed_duplicate_window));
        const routeSuppressedOther = Math.max(0, toNum(bucket.route_suppressed_other));

        return {
          bucket_start: bucket.bucket_start || null,
          bucket_end: bucket.bucket_end || null,
          route_attempted: Math.max(0, toNum(bucket.route_attempted)),
          route_suppressed_total: routeSuppressedTotal,
          route_suppressed_cooldown: routeSuppressedCooldown,
          route_suppressed_duplicate_window: routeSuppressedDuplicateWindow,
          route_suppressed_other: routeSuppressedOther,
          suppression_rate: toNum(bucket.suppression_rate),
          route_attempt_rate: toNum(bucket.route_attempt_rate),
          route_failure_rate: toNum(bucket.route_failure_rate),
          cooldown_share: routeSuppressedTotal > 0
            ? Number((routeSuppressedCooldown / routeSuppressedTotal).toFixed(4))
            : 0,
          duplicate_window_share: routeSuppressedTotal > 0
            ? Number((routeSuppressedDuplicateWindow / routeSuppressedTotal).toFixed(4))
            : 0
        };
      })
      .sort((a, b) => String(a.bucket_start || '').localeCompare(String(b.bucket_start || '')));
  }

  detectCooldownAlerts({ latest, baselineRate }, anomalies) {
    if (!latest || latest.route_suppressed_total < this.minSuppressed) return;

    let level = null;
    if (latest.cooldown_share >= this.criticalCooldownShare) {
      level = 'critical';
    } else if (latest.cooldown_share >= this.warnCooldownShare) {
      level = 'warn';
    }

    if (level) {
      anomalies.push({
        level,
        type: 'cooldown_saturation',
        message: `cooldown_share ${latest.cooldown_share} exceeded ${level === 'critical' ? this.criticalCooldownShare : this.warnCooldownShare}`,
        context: {
          latest_bucket: latest.bucket_start,
          route_suppressed_total: latest.route_suppressed_total,
          route_suppressed_cooldown: latest.route_suppressed_cooldown,
          cooldown_share: latest.cooldown_share
        }
      });
    }

    if (baselineRate > 0) {
      const ratio = Number((latest.cooldown_share / baselineRate).toFixed(4));
      if (ratio >= this.criticalCooldownSpike) {
        anomalies.push({
          level: 'critical',
          type: 'cooldown_spike',
          message: `cooldown_share spike ${ratio} >= ${this.criticalCooldownSpike}`,
          context: {
            latest_bucket: latest.bucket_start,
            latest_cooldown_share: latest.cooldown_share,
            baseline_cooldown_share: baselineRate,
            ratio
          }
        });
      } else if (ratio >= this.warnCooldownSpike) {
        anomalies.push({
          level: 'warn',
          type: 'cooldown_spike',
          message: `cooldown_share spike ${ratio} >= ${this.warnCooldownSpike}`,
          context: {
            latest_bucket: latest.bucket_start,
            latest_cooldown_share: latest.cooldown_share,
            baseline_cooldown_share: baselineRate,
            ratio
          }
        });
      }
    }
  }

  detectDuplicateWindowAlerts({ latest, baselineRate }, anomalies) {
    if (!latest || latest.route_suppressed_total < this.minSuppressed) return;

    let level = null;
    if (latest.duplicate_window_share >= this.criticalDuplicateWindowShare) {
      level = 'critical';
    } else if (latest.duplicate_window_share >= this.warnDuplicateWindowShare) {
      level = 'warn';
    }

    if (level) {
      anomalies.push({
        level,
        type: 'duplicate_window_saturation',
        message: `duplicate_window_share ${latest.duplicate_window_share} exceeded ${level === 'critical' ? this.criticalDuplicateWindowShare : this.warnDuplicateWindowShare}`,
        context: {
          latest_bucket: latest.bucket_start,
          route_suppressed_total: latest.route_suppressed_total,
          route_suppressed_duplicate_window: latest.route_suppressed_duplicate_window,
          duplicate_window_share: latest.duplicate_window_share
        }
      });
    }

    if (baselineRate > 0) {
      const ratio = Number((latest.duplicate_window_share / baselineRate).toFixed(4));
      if (ratio >= this.criticalDuplicateWindowSpike) {
        anomalies.push({
          level: 'critical',
          type: 'duplicate_window_spike',
          message: `duplicate_window_share spike ${ratio} >= ${this.criticalDuplicateWindowSpike}`,
          context: {
            latest_bucket: latest.bucket_start,
            latest_duplicate_window_share: latest.duplicate_window_share,
            baseline_duplicate_window_share: baselineRate,
            ratio
          }
        });
      } else if (ratio >= this.warnDuplicateWindowSpike) {
        anomalies.push({
          level: 'warn',
          type: 'duplicate_window_spike',
          message: `duplicate_window_share spike ${ratio} >= ${this.warnDuplicateWindowSpike}`,
          context: {
            latest_bucket: latest.bucket_start,
            latest_duplicate_window_share: latest.duplicate_window_share,
            baseline_duplicate_window_share: baselineRate,
            ratio
          }
        });
      }
    }
  }

  evaluate({ trend = null } = {}) {
    const normalizedBuckets = this.normalizeBuckets(trend?.buckets || []);

    if (normalizedBuckets.length < this.minBuckets) {
      return {
        level: 'info',
        alert_detected: false,
        should_notify: false,
        reasons: [],
        anomalies: [],
        metrics: {
          bucket_count: normalizedBuckets.length,
          sample_size: toNum(trend?.sample_size),
          latest_bucket: null,
          baseline_bucket_count: 0,
          baseline_cooldown_share: 0,
          baseline_duplicate_window_share: 0
        },
        thresholds: {
          warn_cooldown_share: this.warnCooldownShare,
          critical_cooldown_share: this.criticalCooldownShare,
          warn_duplicate_window_share: this.warnDuplicateWindowShare,
          critical_duplicate_window_share: this.criticalDuplicateWindowShare,
          warn_cooldown_spike: this.warnCooldownSpike,
          critical_cooldown_spike: this.criticalCooldownSpike,
          warn_duplicate_window_spike: this.warnDuplicateWindowSpike,
          critical_duplicate_window_spike: this.criticalDuplicateWindowSpike,
          min_suppressed: this.minSuppressed,
          min_buckets: this.minBuckets,
          baseline_buckets: this.baselineBuckets
        }
      };
    }

    const latest = normalizedBuckets[normalizedBuckets.length - 1];
    const baseline = normalizedBuckets.slice(Math.max(0, normalizedBuckets.length - 1 - this.baselineBuckets), normalizedBuckets.length - 1);

    const cooldownBaselineValues = baseline
      .filter((b) => b.route_suppressed_total >= this.minSuppressed)
      .map((b) => b.cooldown_share)
      .filter((v) => Number.isFinite(v) && v >= 0);

    const duplicateWindowBaselineValues = baseline
      .filter((b) => b.route_suppressed_total >= this.minSuppressed)
      .map((b) => b.duplicate_window_share)
      .filter((v) => Number.isFinite(v) && v >= 0);

    const cooldownBaselineShare = cooldownBaselineValues.length
      ? Number(percentile(cooldownBaselineValues, 50).toFixed(4))
      : 0;

    const duplicateWindowBaselineShare = duplicateWindowBaselineValues.length
      ? Number(percentile(duplicateWindowBaselineValues, 50).toFixed(4))
      : 0;

    const anomalies = [];

    this.detectCooldownAlerts({ latest, baselineRate: cooldownBaselineShare }, anomalies);
    this.detectDuplicateWindowAlerts({ latest, baselineRate: duplicateWindowBaselineShare }, anomalies);

    let level = 'info';
    for (const anomaly of anomalies) {
      if (rankLevel(anomaly.level) > rankLevel(level)) {
        level = anomaly.level;
      }
    }

    const reasons = [...new Set(anomalies.map((a) => a.type))];

    return {
      level,
      alert_detected: anomalies.length > 0,
      should_notify: anomalies.length > 0,
      reasons,
      anomalies,
      metrics: {
        bucket_count: normalizedBuckets.length,
        sample_size: toNum(trend?.sample_size),
        latest_bucket: latest,
        baseline_bucket_count: baseline.length,
        baseline_cooldown_share: cooldownBaselineShare,
        baseline_duplicate_window_share: duplicateWindowBaselineShare
      },
      thresholds: {
        warn_cooldown_share: this.warnCooldownShare,
        critical_cooldown_share: this.criticalCooldownShare,
        warn_duplicate_window_share: this.warnDuplicateWindowShare,
        critical_duplicate_window_share: this.criticalDuplicateWindowShare,
        warn_cooldown_spike: this.warnCooldownSpike,
        critical_cooldown_spike: this.criticalCooldownSpike,
        warn_duplicate_window_spike: this.warnDuplicateWindowSpike,
        critical_duplicate_window_spike: this.criticalDuplicateWindowSpike,
        min_suppressed: this.minSuppressed,
        min_buckets: this.minBuckets,
        baseline_buckets: this.baselineBuckets
      }
    };
  }
}

module.exports = DeployTrendTelemetrySuppressionAlertSuppressionAlertDetector;
