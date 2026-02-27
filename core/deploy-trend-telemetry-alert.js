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

class DeployTrendTelemetryAlertDetector {
  constructor(options = {}) {
    this.warnRouteFailureRate = Number(options.warnRouteFailureRate ?? process.env.DEPLOY_TREND_TELEMETRY_WARN_ROUTE_FAILURE_RATE ?? 0.4);
    this.criticalRouteFailureRate = Number(options.criticalRouteFailureRate ?? process.env.DEPLOY_TREND_TELEMETRY_CRITICAL_ROUTE_FAILURE_RATE ?? 0.75);

    this.warnSuppressionRate = Number(options.warnSuppressionRate ?? process.env.DEPLOY_TREND_TELEMETRY_WARN_SUPPRESSION_RATE ?? 0.5);
    this.criticalSuppressionRate = Number(options.criticalSuppressionRate ?? process.env.DEPLOY_TREND_TELEMETRY_CRITICAL_SUPPRESSION_RATE ?? 0.8);

    this.warnRouteFailureSpike = Number(options.warnRouteFailureSpike ?? process.env.DEPLOY_TREND_TELEMETRY_WARN_ROUTE_FAILURE_SPIKE ?? 1.5);
    this.criticalRouteFailureSpike = Number(options.criticalRouteFailureSpike ?? process.env.DEPLOY_TREND_TELEMETRY_CRITICAL_ROUTE_FAILURE_SPIKE ?? 2.0);

    this.warnSuppressionSpike = Number(options.warnSuppressionSpike ?? process.env.DEPLOY_TREND_TELEMETRY_WARN_SUPPRESSION_SPIKE ?? 1.4);
    this.criticalSuppressionSpike = Number(options.criticalSuppressionSpike ?? process.env.DEPLOY_TREND_TELEMETRY_CRITICAL_SUPPRESSION_SPIKE ?? 1.8);

    this.minDetections = Number(options.minDetections ?? process.env.DEPLOY_TREND_TELEMETRY_MIN_DETECTIONS ?? 3);
    this.minRouteAttempts = Number(options.minRouteAttempts ?? process.env.DEPLOY_TREND_TELEMETRY_MIN_ROUTE_ATTEMPTS ?? 2);
    this.minBuckets = Number(options.minBuckets ?? process.env.DEPLOY_TREND_TELEMETRY_MIN_BUCKETS ?? 1);
    this.baselineBuckets = Number(options.baselineBuckets ?? process.env.DEPLOY_TREND_TELEMETRY_BASELINE_BUCKETS ?? 3);
  }

  normalizeBuckets(buckets = []) {
    return (Array.isArray(buckets) ? buckets : [])
      .map((bucket) => {
        const detected = Math.max(0, toNum(bucket.detected));
        const suppressed = Math.max(0, toNum(bucket.suppressed));
        const routeAttempted = Math.max(0, toNum(bucket.route_attempted));
        const routeDelivered = Math.max(0, toNum(bucket.route_delivered));
        const routeFailed = Math.max(0, toNum(bucket.route_failed));

        return {
          bucket_start: bucket.bucket_start || null,
          bucket_end: bucket.bucket_end || null,
          detected,
          suppressed,
          route_attempted: routeAttempted,
          route_delivered: routeDelivered,
          route_failed: routeFailed,
          suppression_rate: detected > 0
            ? Number((suppressed / detected).toFixed(4))
            : 0,
          route_failure_rate: routeAttempted > 0
            ? Number((routeFailed / routeAttempted).toFixed(4))
            : 0
        };
      })
      .sort((a, b) => String(a.bucket_start || '').localeCompare(String(b.bucket_start || '')));
  }

  detectRouteFailureAlerts({ latest, baselineRate }, anomalies) {
    if (!latest || latest.route_attempted < this.minRouteAttempts) return;

    let level = null;
    if (latest.route_failure_rate >= this.criticalRouteFailureRate) {
      level = 'critical';
    } else if (latest.route_failure_rate >= this.warnRouteFailureRate) {
      level = 'warn';
    }

    if (level) {
      anomalies.push({
        level,
        type: 'route_failure_saturation',
        message: `route_failure_rate ${latest.route_failure_rate} exceeded ${level === 'critical' ? this.criticalRouteFailureRate : this.warnRouteFailureRate}`,
        context: {
          latest_bucket: latest.bucket_start,
          route_attempted: latest.route_attempted,
          route_failed: latest.route_failed,
          route_failure_rate: latest.route_failure_rate
        }
      });
    }

    if (baselineRate > 0) {
      const ratio = Number((latest.route_failure_rate / baselineRate).toFixed(4));

      if (ratio >= this.criticalRouteFailureSpike) {
        anomalies.push({
          level: 'critical',
          type: 'route_failure_spike',
          message: `route_failure_rate spike ${ratio} >= ${this.criticalRouteFailureSpike}`,
          context: {
            latest_bucket: latest.bucket_start,
            latest_route_failure_rate: latest.route_failure_rate,
            baseline_route_failure_rate: baselineRate,
            ratio
          }
        });
      } else if (ratio >= this.warnRouteFailureSpike) {
        anomalies.push({
          level: 'warn',
          type: 'route_failure_spike',
          message: `route_failure_rate spike ${ratio} >= ${this.warnRouteFailureSpike}`,
          context: {
            latest_bucket: latest.bucket_start,
            latest_route_failure_rate: latest.route_failure_rate,
            baseline_route_failure_rate: baselineRate,
            ratio
          }
        });
      }
    }
  }

  detectSuppressionAlerts({ latest, baselineRate }, anomalies) {
    if (!latest || latest.detected < this.minDetections) return;

    let level = null;
    if (latest.suppression_rate >= this.criticalSuppressionRate) {
      level = 'critical';
    } else if (latest.suppression_rate >= this.warnSuppressionRate) {
      level = 'warn';
    }

    if (level) {
      anomalies.push({
        level,
        type: 'suppression_saturation',
        message: `suppression_rate ${latest.suppression_rate} exceeded ${level === 'critical' ? this.criticalSuppressionRate : this.warnSuppressionRate}`,
        context: {
          latest_bucket: latest.bucket_start,
          detected: latest.detected,
          suppressed: latest.suppressed,
          suppression_rate: latest.suppression_rate
        }
      });
    }

    if (baselineRate > 0) {
      const ratio = Number((latest.suppression_rate / baselineRate).toFixed(4));

      if (ratio >= this.criticalSuppressionSpike) {
        anomalies.push({
          level: 'critical',
          type: 'suppression_spike',
          message: `suppression_rate spike ${ratio} >= ${this.criticalSuppressionSpike}`,
          context: {
            latest_bucket: latest.bucket_start,
            latest_suppression_rate: latest.suppression_rate,
            baseline_suppression_rate: baselineRate,
            ratio
          }
        });
      } else if (ratio >= this.warnSuppressionSpike) {
        anomalies.push({
          level: 'warn',
          type: 'suppression_spike',
          message: `suppression_rate spike ${ratio} >= ${this.warnSuppressionSpike}`,
          context: {
            latest_bucket: latest.bucket_start,
            latest_suppression_rate: latest.suppression_rate,
            baseline_suppression_rate: baselineRate,
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
          baseline_bucket_count: 0
        },
        thresholds: {
          warn_route_failure_rate: this.warnRouteFailureRate,
          critical_route_failure_rate: this.criticalRouteFailureRate,
          warn_suppression_rate: this.warnSuppressionRate,
          critical_suppression_rate: this.criticalSuppressionRate,
          warn_route_failure_spike: this.warnRouteFailureSpike,
          critical_route_failure_spike: this.criticalRouteFailureSpike,
          warn_suppression_spike: this.warnSuppressionSpike,
          critical_suppression_spike: this.criticalSuppressionSpike,
          min_detections: this.minDetections,
          min_route_attempts: this.minRouteAttempts,
          min_buckets: this.minBuckets,
          baseline_buckets: this.baselineBuckets
        }
      };
    }

    const latest = normalizedBuckets[normalizedBuckets.length - 1];
    const baseline = normalizedBuckets.slice(Math.max(0, normalizedBuckets.length - 1 - this.baselineBuckets), normalizedBuckets.length - 1);

    const routeFailureBaselineValues = baseline
      .filter((b) => b.route_attempted >= this.minRouteAttempts)
      .map((b) => b.route_failure_rate)
      .filter((v) => Number.isFinite(v) && v >= 0);

    const suppressionBaselineValues = baseline
      .filter((b) => b.detected >= this.minDetections)
      .map((b) => b.suppression_rate)
      .filter((v) => Number.isFinite(v) && v >= 0);

    const routeFailureBaselineRate = routeFailureBaselineValues.length
      ? Number(percentile(routeFailureBaselineValues, 50).toFixed(4))
      : 0;

    const suppressionBaselineRate = suppressionBaselineValues.length
      ? Number(percentile(suppressionBaselineValues, 50).toFixed(4))
      : 0;

    const anomalies = [];

    this.detectRouteFailureAlerts({
      latest,
      baselineRate: routeFailureBaselineRate
    }, anomalies);

    this.detectSuppressionAlerts({
      latest,
      baselineRate: suppressionBaselineRate
    }, anomalies);

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
        baseline_route_failure_rate: routeFailureBaselineRate,
        baseline_suppression_rate: suppressionBaselineRate
      },
      thresholds: {
        warn_route_failure_rate: this.warnRouteFailureRate,
        critical_route_failure_rate: this.criticalRouteFailureRate,
        warn_suppression_rate: this.warnSuppressionRate,
        critical_suppression_rate: this.criticalSuppressionRate,
        warn_route_failure_spike: this.warnRouteFailureSpike,
        critical_route_failure_spike: this.criticalRouteFailureSpike,
        warn_suppression_spike: this.warnSuppressionSpike,
        critical_suppression_spike: this.criticalSuppressionSpike,
        min_detections: this.minDetections,
        min_route_attempts: this.minRouteAttempts,
        min_buckets: this.minBuckets,
        baseline_buckets: this.baselineBuckets
      }
    };
  }
}

module.exports = DeployTrendTelemetryAlertDetector;
